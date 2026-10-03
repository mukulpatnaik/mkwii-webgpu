#include <cmath>
#include <cstdint>
#include <cstring>
#include <iostream>
#include <limits>
#include "ppc_runtime.h"
#include "memory.h"
#include "memory_access.h"
extern "C" void GX_HLE_FIFO_Write8(uint8_t) {}
extern "C" void GX_HLE_FIFO_Write16(uint16_t) {}
extern "C" void GX_HLE_FIFO_Write32(uint32_t) {}
extern "C" void GX_HLE_FIFO_WriteFloat(float) {}
int main() {
    const double nan = std::numeric_limits<double>::quiet_NaN();
    if (PPC_Fsel(nan, 11.0, 22.0) != 11.0) return 1;
    if (PPC_Fsel(-1.0, 11.0, 22.0) != 11.0) return 2;
    if (PPC_Fsel(-0.0, 11.0, 22.0) != 22.0) return 3;
    if (PPC_Fsel(0.0, 11.0, 22.0) != 22.0) return 4;
    PPC_FPR lhs{}; lhs.paired.ps0 = 10.0f; lhs.paired.ps1 = 20.0f;
    PPC_FPR rhs{}; rhs.paired.ps0 = -10.0f; rhs.paired.ps1 = -20.0f;
    PPC_FPR control{}; control.paired.ps0 = std::numeric_limits<float>::quiet_NaN(); control.paired.ps1 = -0.0f;
    PPC_FPR out{}; out.d = PPC_PsSel(lhs.d, control.d, rhs.d);
    if (out.paired.ps0 != rhs.paired.ps0) return 5;
    if (out.paired.ps1 != lhs.paired.ps1) return 6;
    control.paired.ps0 = 1.0f; control.paired.ps1 = -1.0f;
    out.d = PPC_PsSel(lhs.d, control.d, rhs.d);
    if (out.paired.ps0 != lhs.paired.ps0) return 7;
    if (out.paired.ps1 != rhs.paired.ps1) return 8;
    // exact single-rounding fused multiply-add through the paired-single path
    PPC_FPR a{}, b{}, c{}; a.paired.ps0 = 1.0f + 0x1p-23f; a.paired.ps1 = 3.0f;
    b.paired.ps0 = 1.0f + 0x1p-23f; b.paired.ps1 = 0.5f; c.paired.ps0 = -1.0f; c.paired.ps1 = 0.25f;
    PPC_FPR m{}; m.d = PPC_PsMaddInline(a.d, b.d, c.d);
    if (m.paired.ps0 != std::fma(1.0f + 0x1p-23f, 1.0f + 0x1p-23f, -1.0f)) return 9;
    if (m.paired.ps1 != 1.75f) return 10;
    // checked guest memory: MEM1 alias round trip exactly as emitted code does it
    Memory::Init(Memory::Config::WiiDefaults());
    MemoryInline::FlatWrite32(0x80001000u, 0xDEADBEEFu);
    if (MemoryInline::FlatRead32(0xC0001000u) != 0xDEADBEEFu) return 11;
    MemoryInline::FlatWriteFloat32(0x80001004u, 1.5);
    if (MemoryInline::FlatReadFloat32(0x80001004u) != 1.5) return 12;
    if (MemoryInline::FlatRead8(0x80001000u) != 0xDE) return 13; // big-endian byte order preserved
    bool threw = false;
    try { (void)MemoryInline::FlatRead32(0xCC008000u); } catch (const Memory::AccessViolation&) { threw = true; } catch (...) { threw = true; }
    if (!threw) return 14; // MMIO must reach policy, not RAM
    std::cout << "ok";
    return 0;
}
