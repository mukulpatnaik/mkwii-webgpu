//! Spike: open a GameCube/Wii disc image through nod from a host-supplied random-access read
//! callback, so the same wasm works in a Web Worker over `FileReaderSync` (the user's own disc,
//! never uploaded) and under Node for tests. Plain C ABI, no wasm-bindgen: a handful of exports
//! and one import, `env.host_read_at`.
//!
//! wasm32-unknown-unknown is single-threaded, which is why `JsStream` can claim `Send`.

use std::alloc::{alloc, dealloc, Layout};
use std::cell::RefCell;
use std::io::{self, Read};

use nod::common::PartitionKind;
use nod::read::{DiscOptions, DiscReader, DiscStream, PartitionOptions, PartitionReader};

#[link(wasm_import_module = "env")]
extern "C" {
    /// Host fills `len` bytes at `ptr` from byte offset `(hi << 32) | lo` of the image.
    /// Returns 0 on success, nonzero on failure (short read, I/O error).
    fn host_read_at(ptr: *mut u8, len: u32, offset_lo: u32, offset_hi: u32) -> i32;
}

#[derive(Clone)]
struct JsStream {
    len: u64,
}

// Single-threaded wasm: there is no second thread for this to be unsafe on.
unsafe impl Send for JsStream {}

impl DiscStream for JsStream {
    fn read_exact_at(&mut self, buf: &mut [u8], offset: u64) -> io::Result<()> {
        if offset.checked_add(buf.len() as u64).map_or(true, |end| end > self.len) {
            return Err(io::Error::from(io::ErrorKind::UnexpectedEof));
        }
        let rc = unsafe {
            host_read_at(buf.as_mut_ptr(), buf.len() as u32, offset as u32, (offset >> 32) as u32)
        };
        if rc != 0 {
            return Err(io::Error::new(io::ErrorKind::Other, "host read failed"));
        }
        Ok(())
    }

    fn stream_len(&mut self) -> io::Result<u64> {
        Ok(self.len)
    }
}

struct State {
    disc: DiscReader,
    partition: Box<dyn PartitionReader>,
}

thread_local! {
    static STATE: RefCell<Option<State>> = const { RefCell::new(None) };
    static LAST_ERROR: RefCell<String> = const { RefCell::new(String::new()) };
}

fn set_error(message: impl Into<String>) -> i32 {
    LAST_ERROR.with(|e| *e.borrow_mut() = message.into());
    -1
}

fn write_out(out: *mut u8, cap: u32, bytes: &[u8]) -> u32 {
    let n = bytes.len().min(cap as usize);
    if n > 0 {
        unsafe { std::ptr::copy_nonoverlapping(bytes.as_ptr(), out, n) };
    }
    bytes.len() as u32
}

/// Allocate `n` bytes the host may write into (paths) or read from (results).
#[no_mangle]
pub extern "C" fn disc_alloc(n: u32) -> *mut u8 {
    unsafe { alloc(Layout::from_size_align_unchecked(n.max(1) as usize, 1)) }
}

#[no_mangle]
pub extern "C" fn disc_free(ptr: *mut u8, n: u32) {
    unsafe { dealloc(ptr, Layout::from_size_align_unchecked(n.max(1) as usize, 1)) }
}

/// Copies the last error message; returns its full length.
#[no_mangle]
pub extern "C" fn disc_last_error(out: *mut u8, cap: u32) -> u32 {
    LAST_ERROR.with(|e| write_out(out, cap, e.borrow().as_bytes()))
}

/// Opens the image (its byte length split in two words) and its data partition. 0 on success.
#[no_mangle]
pub extern "C" fn disc_open(len_lo: u32, len_hi: u32) -> i32 {
    let len = ((len_hi as u64) << 32) | len_lo as u64;
    let stream: Box<dyn DiscStream> = Box::new(JsStream { len });
    let disc = match DiscReader::new_stream(stream, &DiscOptions::default()) {
        Ok(d) => d,
        Err(e) => return set_error(format!("open: {e}")),
    };
    let partition = match disc.open_partition_kind(PartitionKind::Data, &PartitionOptions::default()) {
        Ok(p) => p,
        Err(e) => return set_error(format!("data partition: {e}")),
    };
    STATE.with(|s| *s.borrow_mut() = Some(State { disc, partition }));
    0
}

/// Writes the 6-byte game ID (e.g. RMCE01). Returns 6, or 0 when nothing is open.
#[no_mangle]
pub extern "C" fn disc_game_id(out: *mut u8) -> u32 {
    STATE.with(|s| match s.borrow().as_ref() {
        Some(st) => write_out(out, 6, &st.disc.header().game_id),
        None => 0,
    })
}

/// Writes "size\tpath\n" for every file in the data partition FST (paths without a leading
/// slash, as nod names them). Returns the full length so the host can size the buffer.
#[no_mangle]
pub extern "C" fn disc_list_files(out: *mut u8, cap: u32) -> u32 {
    STATE.with(|s| {
        let mut guard = s.borrow_mut();
        let Some(st) = guard.as_mut() else { return 0 };
        let meta = match st.partition.meta() {
            Ok(m) => m,
            Err(e) => {
                set_error(format!("meta: {e}"));
                return 0;
            }
        };
        let fst = match meta.fst() {
            Ok(f) => f,
            Err(e) => {
                set_error(format!("fst: {e}"));
                return 0;
            }
        };
        let mut text = String::new();
        for (_, node, path) in fst.iter() {
            if node.is_file() {
                text.push_str(&format!("{}\t{}\n", node.length(), path));
            }
        }
        write_out(out, cap, text.as_bytes())
    })
}

/// Reads a whole file from the data partition into `out`. `which`: 0 = FST path given in
/// (`path`, `path_len`), 1 = main.dol, 2 = fst.bin, 3 = boot.bin, 4 = bi2.bin, 5 = apploader.
/// Returns the file's full length (copying at most `cap` bytes), or -1 on error.
#[no_mangle]
pub extern "C" fn disc_read(which: u32, path: *const u8, path_len: u32, out: *mut u8, cap: u32) -> i64 {
    STATE.with(|s| {
        let mut guard = s.borrow_mut();
        let Some(st) = guard.as_mut() else { return set_error("not open") as i64 };
        let meta = match st.partition.meta() {
            Ok(m) => m,
            Err(e) => return set_error(format!("meta: {e}")) as i64,
        };
        let sys: Option<&[u8]> = match which {
            1 => Some(&meta.raw_dol[..]),
            2 => Some(&meta.raw_fst[..]),
            3 => Some(&meta.raw_boot[..]),
            4 => Some(&meta.raw_bi2[..]),
            5 => Some(&meta.raw_apploader[..]),
            _ => None,
        };
        if let Some(bytes) = sys {
            return write_out(out, cap, bytes) as i64;
        }
        let path = unsafe { std::slice::from_raw_parts(path, path_len as usize) };
        let path = String::from_utf8_lossy(path);
        let fst = match meta.fst() {
            Ok(f) => f,
            Err(e) => return set_error(format!("fst: {e}")) as i64,
        };
        let Some((_, node)) = fst.find(&path) else {
            return set_error(format!("no such file: {path}")) as i64;
        };
        let mut data = Vec::with_capacity(node.length() as usize);
        match st.partition.open_file(node) {
            Ok(mut reader) => {
                if let Err(e) = reader.read_to_end(&mut data) {
                    return set_error(format!("read {path}: {e}")) as i64;
                }
            }
            Err(e) => return set_error(format!("open {path}: {e}")) as i64,
        }
        write_out(out, cap, &data) as i64
    })
}
