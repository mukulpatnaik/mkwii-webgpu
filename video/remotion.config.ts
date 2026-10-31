// Remotion settings for `npx remotion studio` and `npx remotion render` (video/README.md).
import {Config} from '@remotion/cli/config';

Config.setEntryPoint('src/index.ts');
Config.setVideoImageFormat('jpeg');
Config.setOverwriteOutput(true);
Config.setCodec('h264');
Config.setCrf(18);
// The installed Chrome renders the frames; unset REMOTION_BROWSER to let Remotion fetch its own
// headless shell instead.
if (process.env.REMOTION_BROWSER !== '') {
  Config.setBrowserExecutable(process.env.REMOTION_BROWSER ?? (process.platform === 'darwin'
    ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : '/usr/bin/google-chrome'));
}
