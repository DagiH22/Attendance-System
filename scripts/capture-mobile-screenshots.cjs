const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const VIEWPORTS = [
  { width: 320, height: 640, name: "320" },
  { width: 360, height: 780, name: "360" },
  { width: 390, height: 844, name: "390" },
  { width: 412, height: 915, name: "412" },
  { width: 768, height: 1024, name: "768" },
];

const PAGES = [
  { path: "/dashboard", name: "dashboard" },
  { path: "/members", name: "members" },
  { path: "/events", name: "sessions" },
  { path: "/studies", name: "studies" },
  { path: "/login", name: "login" },
];

const OUTPUT_DIR = path.resolve(__dirname, "..", "docs", "mobile-screenshots");

async function run() {
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  // Start vite preview server
  console.log("Starting preview server on port 4173...");
  const preview = spawn("npx", ["vite", "preview", "--port", "4173", "--host", "127.0.0.1"], {
    cwd: path.resolve(__dirname, "..", "frontend"),
    shell: true,
    stdio: "pipe",
  });

  // Give preview server 3s to initialize
  await new Promise((resolve) => setTimeout(resolve, 3000));

  let browser;
  try {
    try {
      browser = await chromium.launch({ headless: true });
    } catch (e) {
      console.log("Default chromium failed, trying msedge channel...");
      browser = await chromium.launch({ headless: true, channel: "msedge" });
    }

    console.log("Browser launched successfully. Capturing mobile screenshots...");

    for (const vp of VIEWPORTS) {
      console.log(`Testing viewport ${vp.width}x${vp.height}...`);
      const context = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        userAgent:
          "Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Mobile/15E148 Safari/604.1",
      });

      // Inject mock token so authenticated pages render
      await context.addInitScript(() => {
        window.localStorage.setItem("attendance_auth_token", "mock-token-for-mobile-audit");
        window.localStorage.setItem(
          "attendance_auth_user",
          JSON.stringify({
            id: "admin-1",
            name: "Audit Admin",
            role: "SUPER_ADMIN",
            campus: "FIVE_KILO",
          })
        );
      });

      const page = await context.newPage();

      for (const p of PAGES) {
        try {
          await page.goto(`http://127.0.0.1:4173${p.path}`, {
            waitUntil: "domcontentloaded",
            timeout: 8000,
          });
          // Small settle time for UI renders and CSS transitions
          await page.waitForTimeout(600);

          const filePath = path.join(OUTPUT_DIR, `${p.name}-${vp.name}.png`);
          await page.screenshot({ path: filePath, fullPage: false });
          console.log(`Saved: ${filePath}`);
        } catch (err) {
          console.warn(`Failed capturing ${p.name} at ${vp.name}:`, err.message);
        }
      }

      await context.close();
    }

    console.log("All mobile screenshots captured successfully!");
  } finally {
    if (browser) await browser.close();
    preview.kill();
  }
}

run().catch((err) => {
  console.error("Screenshot capture script error:", err);
  process.exit(1);
});
