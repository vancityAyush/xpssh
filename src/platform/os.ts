export type Platform = "darwin" | "linux" | "win32";

export interface OsInfo {
  platform: Platform;
  /** ssh-add --apple-use-keychain available */
  hasKeychain: boolean;
  /** ordered candidate commands: [cmd, ...args] receiving text on stdin */
  clipboardCommands: string[][];
  /** command to open a URL: [cmd, ...argsBeforeUrl] */
  openCommand: string[];
}

export function resolveOs(platform: NodeJS.Platform = process.platform): OsInfo {
  switch (platform) {
    case "darwin":
      return {
        platform: "darwin",
        hasKeychain: true,
        clipboardCommands: [["pbcopy"]],
        openCommand: ["open"],
      };
    case "win32":
      return {
        platform: "win32",
        hasKeychain: false,
        clipboardCommands: [["clip.exe"]],
        openCommand: ["cmd", "/c", "start", ""],
      };
    default:
      return {
        platform: "linux",
        hasKeychain: false,
        clipboardCommands: [["xclip", "-selection", "clipboard"], ["xsel", "--clipboard", "--input"], ["wl-copy"]],
        openCommand: ["xdg-open"],
      };
  }
}
