const { execSync } = require("child_process");
const path = require("path");

const viewports = [
  { name: "320", size: "320, 640" },
  { name: "360", size: "360, 780" },
  { name: "390", size: "390, 844" },
  { name: "412", size: "412, 915" },
  { name: "768", size: "768, 1024" },
];

const pages = [
  { name: "dashboard", url: "http://127.0.0.1:4173/dashboard" },
  { name: "members", url: "http://127.0.0.1:4173/members" },
  { name: "sessions", url: "http://127.0.0.1:4173/events" },
  { name: "studies", url: "http://127.0.0.1:4173/studies" },
];

const storageState = path.resolve(__dirname, "..", "docs", "mobile-screenshots", "auth-state.json");
const outputDir = path.resolve(__dirname, "..", "docs", "mobile-screenshots");

for (const vp of viewports) {
  for (const page of pages) {
    const outFile = path.join(outputDir, `${page.name}-${vp.name}.png`);
    const cmd = `npx playwright screenshot --channel msedge --load-storage "${storageState}" --viewport-size "${vp.size}" --wait-for-timeout 1000 "${page.url}" "${outFile}"`;
    console.log(`Capturing ${page.name} at ${vp.name}px...`);
    try {
      execSync(cmd, { stdio: "inherit", shell: true });
    } catch (err) {
      console.warn(`Failed capturing ${page.name} at ${vp.name}:`, err.message);
    }
  }
}
console.log("Screenshots capture complete!");
