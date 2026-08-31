const fs = require("fs");
const proc = require("child_process");

const manifest = JSON.parse(fs.readFileSync("manifest.json", "utf8"));
const versions = JSON.parse(fs.readFileSync("versions.json", "utf8"));
const version = manifest.version;

versions[version] = manifest.minAppVersion;
fs.writeFileSync("versions.json", JSON.stringify(versions, null, "\t") + "\n");

proc.execSync("git add manifest.json versions.json", { stdio: "inherit" });
