// Turns the built app (dist/) into a real Windows program, in
// release\Mochi Claude-win32-x64\mochi-claude.exe.
//
// @electron/packager copies Electron's own runtime next to our files (in resources\app)
// and stamps the .exe with Mochi's name and icon. Only package.json and dist/ go in;
// nothing else from this folder is needed to run.
//
//   pnpm run package     (builds first)

import { packager } from "@electron/packager";

const [folder] = await packager({
  dir: ".",
  out: "release",
  overwrite: true,
  platform: "win32",
  arch: "x64",
  name: "Mochi Claude",
  executableName: "mochi-claude",
  icon: "assets/icon.ico",
  // Plain files rather than one archive, so anyone can look at what is inside.
  asar: false,
  prune: false,
  ignore: (file) => !(file === "" || file === "/package.json" || file === "/dist" || file.startsWith("/dist/")),
  win32metadata: {
    CompanyName: "mochi-claude",
    FileDescription: "Mochi Claude",
    ProductName: "Mochi Claude",
    InternalName: "mochi-claude",
  },
});

console.log(`packaged: ${folder}`);
