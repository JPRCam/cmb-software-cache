const fs = require("fs");
const axios = require("axios");
const download = require("download");
const htmlGenerator = require("./htmlGenerator");

const downloadsPath = "public/downloads/";
const specialRules = ["FLEx"];

// softwares.json is the user config listing the software desired and where to get it
// downloads.json is generated by this script and includes the same information plus information about the latest download for that software
let softwares = JSON.parse(fs.readFileSync("softwares.json"));
let downloads = JSON.parse(fs.readFileSync("downloads.json"));

updateAllSoftware(softwares, downloads).then(() => {
  // console.log(softwares);
  fs.writeFileSync("downloads.json", JSON.stringify(downloads));
  htmlGenerator();
});

// END

async function updateAllSoftware(softwares, downloads) {
  for (let i = 0; i < softwares.length; ++i) {
    const software = softwares[i];
    const download = updateAndGetDownloadConfig(downloads, software);
    download.errorFlag = null;

    console.log(`Processing ${software.title}...`);
    try {
      let downloadUrl;
      if (specialRules.includes(software.title)) {
        downloadUrl = await downloadUrlForSpecialCases(software);
      } else {
        const html = await getHTML(software.downloadPage);
        downloadUrl = findDownloadPath(software, html);
      }

      const version = getVersionNumber(downloadUrl);
      if (version == download.version) continue;

      if (new RegExp('^/').test(downloadUrl)) {
        downloadUrl = new URL(downloadUrl, software.downloadPage).toString();
      }

      const filepath = await downloadFile(
        downloadUrl,
        newFilename(downloadUrl, version, download.localPath)
      );

      moveOldFile(download.localPath);

      download.localPath = filepath;
      download.version = version;
    } catch (error) {
      console.error(error);
      download.errorFlag = error.message || error;
    }
  }
}

function updateAndGetDownloadConfig(downloads, software) {
  let download = downloads[software.title] || {};
  downloads[software.title] = Object.assign(download, software);
  return downloads[software.title];
}

async function getHTML(url) {
  return await tryAFewTimes(3, async () => {
    const response = await axios.get(url, {
      responseType: "document"
    });
    return response.data;
  });
}

async function tryAFewTimes(tries, asyncFunc) {
  let tryNumber = 0;
  while (tryNumber < tries) {
    try {
      return await asyncFunc();
    } catch (error) {
      console.error(error);
      tryNumber += 1;
      if (tryNumber == tries) throw error;
      console.error(`[tryAFewTimes] Try #${tryNumber + 1} of ${tries}...`);
    }
  }
}

// Find a tag matching the tag pattern with a reference matching the path pattern
function findDownloadPath(software, html) {
  const tagPattern = software.downloadLinkPattern
    ? new RegExp(software.downloadLinkPattern, "g")
    : /<a[^>]+?>/g;
  const pathPattern = software.downloadPathPattern
    ? new RegExp(software.downloadPathPattern)
    : /href=['"]([^'"]+(msi|exe))['"]/;
  let tagMatch;
  while ((tagMatch = tagPattern.exec(html))) {
    // console.log(`    ${software.title} - Link: ${tagMatch[0]}`); // Debug code
    const pathMatch = pathPattern.exec(tagMatch[0]);
    if (pathMatch) return pathMatch[1];
  }
  throw "No matching download path found on download page.";
}

// Return the longest combination of digits and decimals in the path
function getVersionNumber(path) {
  const pattern = /\d[_.\d]+\d/g;
  let version = "";
  let match;
  while ((match = pattern.exec(path))) {
    if (match[0].length > version.length) version = match[0];
  }
  if (!version) throw "No version number found in download path.";
  return version;
}

// Make sure the filename for the new version is different from the old
function newFilename(url, version, oldDownloadPath) {
  let filename = filenameOf(url);
  if (oldDownloadPath && filename == filenameOf(oldDownloadPath)) {
    const lastDot = filename.lastIndexOf(".");
    filename = filename.slice(0, lastDot) + version + filename.slice(lastDot);
  }
  return filename;
}

// Download from the url and save to the downloads folder
async function downloadFile(url, filename) {
  console.log("Downloading " + filename + " at " + url);
  await download(url, downloadsPath, { filename: filename });
  return downloadsPath + filename;
}

function moveOldFile(oldFilePath) {
  if (oldFilePath) {
    const oldFileName = filenameOf(oldFilePath);
    fs.rename(oldFilePath, `${downloadsPath}old/${oldFileName}`, () => {});
  }
}

function filenameOf(urlOrPath) {
  return urlOrPath.slice(urlOrPath.lastIndexOf("/") + 1);
}

async function downloadUrlForSpecialCases(software) {
  switch (software.title) {
    case "FLEx":
      return await downloadUrlFlex(software);
  }
}

async function downloadUrlFlex(software) {
  const downloadPageHtml = await getHTML(
    "https://software.sil.org/fieldworks/download/"
  );
  let patterns = {
    downloadPathPattern: `href=['"](https?://software.sil.org/fieldworks/download/fw.+)['"]`
  };
  const realDownloadPageUrl = await findDownloadPath(
    patterns,
    downloadPageHtml
  );
  const realDownloadHtml = await getHTML(realDownloadPageUrl);
  return await findDownloadPath({}, realDownloadHtml);
}
