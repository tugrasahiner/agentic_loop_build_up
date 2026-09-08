// ============================================================
// AI Operating System — Drive Manager (Google Apps Script)
//
// WHAT THIS SOLVES
// AI assistants writing into a cloud drive often cannot choose the
// destination folder — every file they create lands in the drive root.
// This script makes the FILENAME the address instead. An assistant writes
// "Sync_CTO_2026-08-10.md" to root; this script reads that name, moves the
// file to AI Operating System/Sync/CTO/, and strips the prefix so it lands
// as "2026-08-10.md" in the right place.
//
// WHAT IT DOES
//   1. Root routing      — route prefixed files to their folders,
//                          descending into nested subfolders when they exist
//   2. Deduplication     — keep newest, trash older copies (the connector
//                          creates rather than overwrites, so duplicates
//                          accumulate on every repeated write)
//   3. Notifications     — email alerts for configured categories
//   4. Monthly archival  — roll over the key decisions log
//   5. Quarterly archival— roll past milestones out of the timeline
//
// SETUP
//   1. Go to script.google.com and create a new project
//   2. Paste this file in
//   3. Edit CONFIG below — at minimum NOTIFICATION_EMAIL and ADVISOR_NAMES
//   4. Run setupTriggers() once and authorise when prompted
//   5. Run manualRun() to verify, then check the Execution Log
//
// IMPORTANT: ADVISOR_NAMES must match the short names your advisors use in
// their filenames, exactly. A name that isn't in this list is SKIPPED, not
// guessed at — the file stays in root indefinitely and nothing reports it.
// When you add an advisor to your team, add them here in the same sitting.
//
// Runs on your own account with your own permissions, on Google's servers.
// No third-party access, no credentials stored anywhere, nothing to host.
// ============================================================


// ---- CONFIGURATION ----

const CONFIG = {
  // Top-level folder holding the whole structure
  ROOT_PATH: "AI Operating System",

  // Where routing notifications are sent
  NOTIFICATION_EMAIL: "your-email@example.com",
  EMAIL_SUBJECT_PREFIX: "[AI OS]",

  // Which categories exist, and how each behaves.
  // notify  — email you when a file lands here
  // cleanup — deduplicate this category's folders
  CATEGORY_CONFIG: {
    "Sync":  { notify: true,  cleanup: true },
    "KB":    { notify: false, cleanup: true },
    "Tasks": { notify: true,  cleanup: true }
  },

  // Your advisors' short names, exactly as they appear in filenames.
  // "Shared" is the common folder every advisor reads and writes.
  ADVISOR_NAMES: ["CTO", "CPO", "CMO", "CFO", "Architect", "Shared"],

  // Files that should never trigger a notification (housekeeping files
  // that change constantly and mean nothing to you)
  IGNORE_FILES: ["last-sync.txt"],

  LAST_CHECK_KEY: "lastRoutingCheck",

  // Archival runs a few days into the period rather than on the 1st, so a
  // late entry doesn't get filed into the wrong month or quarter.
  ARCHIVAL_GRACE_DAY: 3,
  QUARTERLY_GRACE_DAY: 3,

  SHARED_SYNC_PATH: "AI Operating System/Sync/Shared"
};


// ============================================================
// 1. MAIN
// ============================================================

function main() {
  Logger.log("=== AI OS Drive Manager — Starting ===");

  const rootCleaned = deduplicateRoot();
  Logger.log("Root deduplication complete. Duplicates trashed: " + rootCleaned);

  const routed = routeRootFiles();
  Logger.log("Routing complete. Files routed: " + routed.length);

  const totalCleaned = cleanupTargetFolders();
  Logger.log("Cleanup complete. Duplicates trashed: " + totalCleaned);

  sendRoutingNotifications(routed);

  checkMonthlyArchival();
  checkQuarterlyArchival();

  PropertiesService.getScriptProperties()
    .setProperty(CONFIG.LAST_CHECK_KEY, new Date().toISOString());

  Logger.log("=== AI OS Drive Manager — Complete ===");
}


// ============================================================
// 2. ROOT DEDUPLICATION
//
// Runs before routing. If an assistant wrote the same filename twice,
// only the newest copy is worth moving.
// ============================================================

function deduplicateRoot() {
  var root = DriveApp.getRootFolder();
  var files = root.getFiles();
  var fileMap = {};

  while (files.hasNext()) {
    var file = files.next();
    var name = file.getName();

    var parsed = parsePrefixedFilename(name);
    if (!parsed) continue;
    if (!CONFIG.CATEGORY_CONFIG[parsed.category]) continue;
    if (CONFIG.ADVISOR_NAMES.indexOf(parsed.advisorName) === -1) continue;

    if (!fileMap[name]) fileMap[name] = [];
    fileMap[name].push({ file: file, created: file.getDateCreated() });
  }

  var trashedCount = 0;

  Object.keys(fileMap).forEach(function(name) {
    var versions = fileMap[name];
    if (versions.length <= 1) return;

    versions.sort(function(a, b) {
      return b.created.getTime() - a.created.getTime();
    });

    for (var i = 1; i < versions.length; i++) {
      Logger.log("Trashing root duplicate: " + name +
                 " (created: " + versions[i].created.toISOString() + ")");
      versions[i].file.setTrashed(true);
      trashedCount++;
    }
  });

  return trashedCount;
}


// ============================================================
// 3. ROOT ROUTING
//
// Parses {Category}_{Advisor}_{rest} filenames and moves each file to
// its folder, descending into nested subfolders where they exist.
// ============================================================

function routeRootFiles() {
  const root = DriveApp.getRootFolder();
  const files = root.getFiles();
  const routed = [];

  while (files.hasNext()) {
    var file = files.next();
    var name = file.getName();

    var parsed = parsePrefixedFilename(name);
    if (!parsed) continue;

    if (!CONFIG.CATEGORY_CONFIG[parsed.category]) {
      Logger.log("Unknown category, skipping: " + name);
      continue;
    }
    if (CONFIG.ADVISOR_NAMES.indexOf(parsed.advisorName) === -1) {
      Logger.log("Unknown advisor name, skipping: " + name);
      continue;
    }

    // Locate the advisor's folder for this category
    var advisorFolderPath = CONFIG.ROOT_PATH + "/" +
                            categoryToFolder(parsed.category) + "/" +
                            parsed.advisorName;
    var advisorFolder = getFolderByPath(advisorFolderPath);

    if (!advisorFolder) {
      Logger.log("Target folder not found, skipping: " + advisorFolderPath);
      continue;
    }

    // Descend further if the remaining segments match real subfolders
    var resolved = resolveSubfolders(advisorFolder, parsed.remainder);
    var targetFolder = resolved.folder;
    var strippedName = resolved.strippedName;
    var subfolderSegments = resolved.subfolderSegments;

    var fullPathSegments = [categoryToFolder(parsed.category), parsed.advisorName]
                             .concat(subfolderSegments);
    var targetPath = CONFIG.ROOT_PATH + "/" + fullPathSegments.join("/");

    var newFile = file.makeCopy(strippedName, targetFolder);
    Logger.log("Routed: " + name + " → " + targetPath + "/" + strippedName);

    file.setTrashed(true);

    routed.push({
      originalName: name,
      strippedName: strippedName,
      category: parsed.category,
      advisorName: parsed.advisorName,
      subfolderSegments: subfolderSegments,
      targetPath: targetPath,
      url: newFile.getUrl(),
      created: newFile.getDateCreated()
    });
  }

  return routed;
}

// Splits "{Category}_{Advisor}_{rest}" into its three parts.
// Returns null for any filename that doesn't have at least two underscores,
// which is how ordinary files in your root are left alone.
function parsePrefixedFilename(filename) {
  var firstUnderscore = filename.indexOf("_");
  if (firstUnderscore === -1) return null;

  var secondUnderscore = filename.indexOf("_", firstUnderscore + 1);
  if (secondUnderscore === -1) return null;

  var category = filename.substring(0, firstUnderscore);
  var advisorName = filename.substring(firstUnderscore + 1, secondUnderscore);
  var remainder = filename.substring(secondUnderscore + 1);

  if (!category || !advisorName || !remainder) return null;

  return {
    category: category,
    advisorName: advisorName,
    remainder: remainder
  };
}

// Walks the remainder, peeling underscore-delimited segments and descending
// into matching physical subfolders. Stops when the next segment doesn't
// match a folder, or when only one segment (the filename) is left.
//
// Example: advisorFolder = Tasks/CPO, remainder = "Drafts_roadmap.md"
//   - If Drafts/ exists  → Tasks/CPO/Drafts/roadmap.md
//   - If Drafts/ missing → Tasks/CPO/Drafts_roadmap.md
//
// The fallback is deliberately non-destructive. A file you can find in the
// wrong place beats a clever guess you can't reconstruct.
function resolveSubfolders(advisorFolder, remainder) {
  var currentFolder = advisorFolder;
  var segments = remainder.split("_");
  var consumed = [];

  // Never consume the final segment — that's the filename.
  while (segments.length > 1) {
    var candidate = segments[0];
    var subFolders = currentFolder.getFoldersByName(candidate);
    if (!subFolders.hasNext()) break;

    currentFolder = subFolders.next();
    consumed.push(candidate);
    segments.shift();
  }

  return {
    folder: currentFolder,
    strippedName: segments.join("_"),
    subfolderSegments: consumed
  };
}

// Maps the short category prefix to its folder name on disk.
function categoryToFolder(category) {
  var map = {
    "Sync": "Sync",
    "KB": "Knowledge Base",
    "Tasks": "Tasks"
  };
  return map[category] || category;
}


// ============================================================
// 4. DUPLICATE CLEANUP
//
// Recursive within each {Category}/{Advisor} tree. Each folder is
// deduplicated independently, so the same filename in two different
// folders is NEVER treated as a duplicate — two advisors can both have
// a notes.md and neither loses one.
// ============================================================

function cleanupTargetFolders() {
  var osFolder = getFolderByPath(CONFIG.ROOT_PATH);
  if (!osFolder) {
    Logger.log("ERROR: root folder not found: " + CONFIG.ROOT_PATH);
    return 0;
  }

  var totalTrashed = 0;

  Object.keys(CONFIG.CATEGORY_CONFIG).forEach(function(category) {
    var catConfig = CONFIG.CATEGORY_CONFIG[category];
    if (!catConfig.cleanup) return;

    var catFolderName = categoryToFolder(category);
    var catFolders = osFolder.getFoldersByName(catFolderName);
    if (!catFolders.hasNext()) {
      Logger.log("Category folder not found: " + catFolderName);
      return;
    }
    var catFolder = catFolders.next();

    CONFIG.ADVISOR_NAMES.forEach(function(advisorName) {
      var subFolders = catFolder.getFoldersByName(advisorName);
      if (!subFolders.hasNext()) return;

      var folder = subFolders.next();
      totalTrashed += cleanupFolderTree(folder, catFolderName + "/" + advisorName);
    });
  });

  return totalTrashed;
}

function cleanupFolderTree(folder, folderLabel) {
  var trashed = cleanupFolder(folder, folderLabel);

  var children = folder.getFolders();
  while (children.hasNext()) {
    var child = children.next();
    trashed += cleanupFolderTree(child, folderLabel + "/" + child.getName());
  }

  return trashed;
}

function cleanupFolder(folder, folderLabel) {
  var files = folder.getFiles();
  var fileMap = {};

  while (files.hasNext()) {
    var file = files.next();
    var name = file.getName();

    if (!fileMap[name]) fileMap[name] = [];
    fileMap[name].push({ file: file, created: file.getDateCreated() });
  }

  var trashedCount = 0;

  Object.keys(fileMap).forEach(function(name) {
    var versions = fileMap[name];
    if (versions.length <= 1) return;

    versions.sort(function(a, b) {
      return b.created.getTime() - a.created.getTime();
    });

    for (var i = 1; i < versions.length; i++) {
      Logger.log("Trashing duplicate: " + folderLabel + "/" + name +
                 " (created: " + versions[i].created.toISOString() + ")");
      versions[i].file.setTrashed(true);
      trashedCount++;
    }
  });

  if (trashedCount > 0) {
    Logger.log(folderLabel + ": trashed " + trashedCount + " duplicate(s)");
  }

  return trashedCount;
}


// ============================================================
// 5. NOTIFICATIONS
// ============================================================

function sendRoutingNotifications(routedFiles) {
  var notifiable = routedFiles.filter(function(f) {
    var catConfig = CONFIG.CATEGORY_CONFIG[f.category];
    return catConfig && catConfig.notify;
  });

  notifiable = notifiable.filter(function(f) {
    for (var i = 0; i < CONFIG.IGNORE_FILES.length; i++) {
      if (f.strippedName.indexOf(CONFIG.IGNORE_FILES[i]) !== -1) return false;
    }
    return true;
  });

  if (notifiable.length === 0) {
    Logger.log("No notifiable files this cycle.");
    return;
  }

  var subject = CONFIG.EMAIL_SUBJECT_PREFIX + " " + notifiable.length +
                " new file" + (notifiable.length > 1 ? "s" : "") + " routed";

  var body = "AI Operating System — Files Routed\n";
  body += "----------------------------------\n\n";

  notifiable.forEach(function(f) {
    var timeStr = f.created.toLocaleString("en-GB");
    var pathSegments = [f.category, f.advisorName].concat(f.subfolderSegments || []);
    body += pathSegments.join(" / ") + " / " + f.strippedName + "\n";
    body += "   Routed from: " + f.originalName + "\n";
    body += "   Time: " + timeStr + "\n";
    body += "   Open: " + f.url + "\n\n";
  });

  body += "----------------------------------\n";
  body += "Sent by AI OS Drive Manager.\n";
  body += "To adjust notifications, edit CATEGORY_CONFIG in the script.";

  MailApp.sendEmail({
    to: CONFIG.NOTIFICATION_EMAIL,
    subject: subject,
    body: body
  });

  Logger.log("Notification sent for " + notifiable.length + " file(s).");
}


// ============================================================
// 6. MONTHLY ARCHIVAL — key decisions log
//
// The decisions log is append-only, so it grows forever unless something
// retires it. An advisor reading a two-year log pays to re-read its own
// history on every sync.
// ============================================================

function checkMonthlyArchival() {
  var now = new Date();
  if (now.getDate() !== CONFIG.ARCHIVAL_GRACE_DAY) return;

  var props = PropertiesService.getScriptProperties();
  var currentMonth = now.getFullYear() + "-" + padZero(now.getMonth() + 1);
  if (props.getProperty("lastMonthlyArchival") === currentMonth) return;

  Logger.log("Monthly archival check — running for " + currentMonth);

  var sharedFolder = getFolderByPath(CONFIG.SHARED_SYNC_PATH);
  if (!sharedFolder) {
    Logger.log("ERROR: shared sync folder not found");
    return;
  }

  var currentFile = getNewestFileByName(sharedFolder, "key-decisions-current.md");
  if (!currentFile) {
    Logger.log("No key-decisions-current.md found — skipping archival");
    return;
  }

  var prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  var archiveName = "key-decisions-" + prevMonth.getFullYear() + "-" +
                    padZero(prevMonth.getMonth() + 1) + ".md";

  if (getNewestFileByName(sharedFolder, archiveName)) {
    Logger.log("Archive already exists: " + archiveName + " — skipping");
    props.setProperty("lastMonthlyArchival", currentMonth);
    return;
  }

  var content = currentFile.getBlob().getDataAsString();

  sharedFolder.createFile(archiveName, content, MimeType.PLAIN_TEXT);
  Logger.log("Created archive: " + archiveName);

  var freshContent = "# Key Decisions Log (Current Month)\n\nAppend new decisions below.\n";
  sharedFolder.createFile("key-decisions-current.md", freshContent, MimeType.PLAIN_TEXT);
  Logger.log("Created fresh key-decisions-current.md");

  props.setProperty("lastMonthlyArchival", currentMonth);

  MailApp.sendEmail({
    to: CONFIG.NOTIFICATION_EMAIL,
    subject: CONFIG.EMAIL_SUBJECT_PREFIX + " Monthly archival complete",
    body: "Key decisions log archived as: " + archiveName + "\n" +
          "A fresh key-decisions-current.md has been created.\n\n" +
          "If anything looks wrong, the archive and the previous current file " +
          "are both in the Shared folder. The old current file will be cleaned " +
          "up as a duplicate on the next cycle."
  });
}


// ============================================================
// 7. QUARTERLY ARCHIVAL — timeline past milestones
//
// Recognised date formats in timeline entries: "Q3 2026", "2026-08",
// "10.08.2026". Entries without a recognisable date are never archived —
// a safe default, but undated milestones will accumulate.
// ============================================================

function checkQuarterlyArchival() {
  var now = new Date();
  var month = now.getMonth();

  var isQuarterStart = (month === 0 || month === 3 || month === 6 || month === 9);
  if (!isQuarterStart || now.getDate() !== CONFIG.QUARTERLY_GRACE_DAY) return;

  var props = PropertiesService.getScriptProperties();
  var currentQuarter = now.getFullYear() + "-Q" + (Math.floor(month / 3) + 1);
  if (props.getProperty("lastQuarterlyArchival") === currentQuarter) return;

  Logger.log("Quarterly archival check — running for " + currentQuarter);

  var sharedFolder = getFolderByPath(CONFIG.SHARED_SYNC_PATH);
  if (!sharedFolder) {
    Logger.log("ERROR: shared sync folder not found");
    return;
  }

  var timelineFile = getNewestFileByName(sharedFolder, "master-timeline.md");
  if (!timelineFile) {
    Logger.log("No master-timeline.md found — skipping quarterly archival");
    props.setProperty("lastQuarterlyArchival", currentQuarter);
    return;
  }

  var lines = timelineFile.getBlob().getDataAsString().split("\n");

  var prevQuarterMonth = new Date(now.getFullYear(), month - 3, 1);
  var prevQuarterNum = Math.floor(prevQuarterMonth.getMonth() / 3) + 1;
  var archiveName = "timeline-archive-" + prevQuarterMonth.getFullYear() +
                    "-Q" + prevQuarterNum + ".md";

  if (getNewestFileByName(sharedFolder, archiveName)) {
    Logger.log("Quarterly archive already exists: " + archiveName + " — skipping");
    props.setProperty("lastQuarterlyArchival", currentQuarter);
    return;
  }

  var pastLines = [];
  var futureLines = [];
  var headerLines = [];

  lines.forEach(function(line) {
    var trimmed = line.trim();

    // Anything that isn't a list item is treated as structure and kept
    if (!trimmed.startsWith("-")) {
      headerLines.push(line);
      return;
    }

    if (isMilestonePast(trimmed, now)) {
      pastLines.push(line);
    } else {
      futureLines.push(line);
    }
  });

  if (pastLines.length === 0) {
    Logger.log("No past milestones found — skipping quarterly archival");
    props.setProperty("lastQuarterlyArchival", currentQuarter);
    return;
  }

  var archiveContent = "# Timeline Archive — " + prevQuarterMonth.getFullYear() +
                       " Q" + prevQuarterNum + "\n\n";
  archiveContent += "Archived on: " + now.toISOString().substring(0, 10) + "\n\n";
  archiveContent += pastLines.join("\n") + "\n";
  sharedFolder.createFile(archiveName, archiveContent, MimeType.PLAIN_TEXT);
  Logger.log("Created quarterly archive: " + archiveName +
             " (" + pastLines.length + " entries)");

  var changelogFile = getNewestFileByName(sharedFolder, "timeline-changelog.md");
  var changelogContent = changelogFile
    ? changelogFile.getBlob().getDataAsString()
    : "# Timeline Changelog\n";
  var today = now.toISOString().substring(0, 10);
  changelogContent += "\n## " + today + " | Apps Script (Automated)\n";
  changelogContent += "Archived " + pastLines.length + " past milestone(s) to " + archiveName + "\n";
  changelogContent += "Entries:\n";
  pastLines.forEach(function(line) {
    changelogContent += "  " + line.trim() + "\n";
  });
  sharedFolder.createFile("timeline-changelog.md", changelogContent, MimeType.PLAIN_TEXT);

  var updatedContent = headerLines.join("\n") + "\n" + futureLines.join("\n") + "\n";
  sharedFolder.createFile("master-timeline.md", updatedContent, MimeType.PLAIN_TEXT);
  Logger.log("Updated master-timeline.md — removed " + pastLines.length + " past entries");

  props.setProperty("lastQuarterlyArchival", currentQuarter);

  MailApp.sendEmail({
    to: CONFIG.NOTIFICATION_EMAIL,
    subject: CONFIG.EMAIL_SUBJECT_PREFIX + " Quarterly timeline archival complete",
    body: "Archived " + pastLines.length + " past milestone(s) to: " + archiveName + "\n" +
          "Timeline changelog updated.\n" +
          "Master timeline updated (past entries removed).\n\n" +
          "Review the archive in Sync/Shared if anything looks off."
  });
}

function isMilestonePast(line, now) {
  // "Q3 2026"
  var quarterMatch = line.match(/Q(\d)\s+(\d{4})/);
  if (quarterMatch) {
    var q = parseInt(quarterMatch[1]);
    var y = parseInt(quarterMatch[2]);
    var quarterEnd = new Date(y, q * 3, 0);
    return now > quarterEnd;
  }

  // "2026-08"
  var yearMonthMatch = line.match(/(\d{4})-(\d{2})/);
  if (yearMonthMatch) {
    var endOfMonth = new Date(parseInt(yearMonthMatch[1]),
                              parseInt(yearMonthMatch[2]), 0);
    return now > endOfMonth;
  }

  // "10.08.2026"
  var dateMatch = line.match(/(\d{2})\.(\d{2})\.(\d{4})/);
  if (dateMatch) {
    var specificDate = new Date(parseInt(dateMatch[3]),
                                parseInt(dateMatch[2]) - 1,
                                parseInt(dateMatch[1]));
    return now > specificDate;
  }

  return false;
}


// ============================================================
// 8. SETUP — run this once
// ============================================================

function setupTriggers() {
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    ScriptApp.deleteTrigger(trigger);
  });

  ScriptApp.newTrigger("main")
    .timeBased()
    .everyMinutes(30)
    .create();

  Logger.log("Trigger created: main() every 30 minutes");

  PropertiesService.getScriptProperties()
    .setProperty(CONFIG.LAST_CHECK_KEY, new Date().toISOString());
  Logger.log("Last check timestamp initialised to now.");
}


// ============================================================
// 9. UTILITY
// ============================================================

function getFolderByPath(path) {
  var parts = path.split("/");
  var current = DriveApp.getRootFolder();

  for (var i = 0; i < parts.length; i++) {
    var folders = current.getFoldersByName(parts[i]);
    if (!folders.hasNext()) return null;
    current = folders.next();
  }

  return current;
}

function getNewestFileByName(folder, filename) {
  var files = folder.getFilesByName(filename);
  var newest = null;
  var newestDate = null;

  while (files.hasNext()) {
    var file = files.next();
    var created = file.getDateCreated();
    if (!newest || created > newestDate) {
      newest = file;
      newestDate = created;
    }
  }

  return newest;
}

function padZero(n) {
  return n < 10 ? "0" + n : "" + n;
}


// ============================================================
// 10. MANUAL OPERATIONS — for testing and one-off runs
// ============================================================

function manualRun() {
  Logger.log("Running manual cycle...");
  main();
  Logger.log("Done. Check the Execution Log for details.");
}

function manualRouteOnly() {
  Logger.log("Running routing only...");
  var routed = routeRootFiles();
  Logger.log("Routed " + routed.length + " file(s). Check the Execution Log.");
}

function manualCleanupOnly() {
  Logger.log("Running cleanup only...");
  var cleaned = cleanupTargetFolders();
  Logger.log("Trashed " + cleaned + " duplicate(s). Check the Execution Log.");
}
