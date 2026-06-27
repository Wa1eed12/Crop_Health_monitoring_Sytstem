var DRIVE_FOLDER_NAME = 'CropHealthReports';
var RECIPIENT_EMAIL = 'waleedasif651@gmail.com';
var SENDER_NAME = 'Crop Health Monitor';

// Get every file in the folder whose name starts with "summary"
function getAllSummaryFiles() {
  var folder = DriveApp.getFoldersByName(DRIVE_FOLDER_NAME).next();
  var allFiles = folder.getFiles();
  var summaryFiles = [];

  while (allFiles.hasNext()) {
    var file = allFiles.next();
    if (file.getName().indexOf('summary') === 0) {
      summaryFiles.push(file);
    }
  }

  return summaryFiles;
}

// Read one file and extract the JSON part from it
function readSummaryFile(file) {
  var text = file.getBlob().getDataAsString();

  Logger.log('CSV content: ' + text);

  var lines = text.split('\n');
  var dataLine = lines[1];

  var firstComma = dataLine.indexOf(',');
  var rest = dataLine.substring(firstComma + 1);

  // rest now starts right at the opening quote of the json column
  var i = 1; // skip the opening quote
  while (i < rest.length) {
    if (rest.charAt(i) == '"') {
      if (rest.charAt(i + 1) == '"') {
        i = i + 2; // escaped quote inside the JSON, keep going
        continue;
      } else {
        break; // this is the real closing quote
      }
    }
    i = i + 1;
  }

  var jsonPart = rest.substring(1, i);
  jsonPart = jsonPart.replace(/""/g, '"');

  Logger.log('Extracted JSON: ' + jsonPart);

  var data = JSON.parse(jsonPart);
  return data;
}

// Build the HTML email - purple dashboard style
function buildEmail(data) {
  var statusColor = '#27ae60';
  if (data.overallStatus == 'WARNING') statusColor = '#e67e22';
  if (data.overallStatus == 'CRITICAL') statusColor = '#e74c3c';

  var overallSummary = 'All crop indicators are within healthy ranges — no action needed.';
  if (data.overallStatus == 'WARNING') overallSummary = 'Some crop indicators need attention — review stressed items below.';
  if (data.overallStatus == 'CRITICAL') overallSummary = 'Multiple indicators critical — immediate field inspection recommended.';

  var sensorLabel = data.sensorUsed;
  if (data.sensorUsed == 'SENTINEL2') sensorLabel = 'Sentinel-2 (10m resolution)';
  if (data.sensorUsed == 'LANDSAT9') sensorLabel = 'Landsat 9 (30m resolution)';
  if (data.sensorUsed == 'LANDSAT8') sensorLabel = 'Landsat 8 (30m resolution)';
  if (data.sensorUsed == 'MODIS') sensorLabel = 'MODIS (250m resolution — low-resolution fallback)';

  var BRAND_PURPLE = '#6C5CE7';
  var BRAND_PURPLE_DARK = '#5849c4';
  var BG_LIGHT = '#F5F4FB';
  var CARD_BORDER = '#ECEAF7';
  var TEXT_DARK = '#2D2A4A';
  var TEXT_MUTED = '#8B89A8';

  var html = '<div style="font-family:Segoe UI,Arial,sans-serif;max-width:640px;margin:0 auto;background:' + BG_LIGHT + ';">';

  html += '<div style="background:' + BRAND_PURPLE + ';padding:28px 24px;text-align:center;">';
  html += '<h1 style="color:white;margin:0;font-size:21px;font-weight:600;">Crop Health Report</h1>';
  html += '<p style="color:#E4E1FA;margin:6px 0 0;font-size:13px;">Image Date: ' + data.imageDate + ' &nbsp;·&nbsp; Source: ' + sensorLabel + '</p>';
  html += '</div>';

  html += '<div style="background:white;margin:16px;padding:24px 20px;text-align:center;border-radius:14px;border:1px solid ' + CARD_BORDER + ';box-shadow:0 2px 10px rgba(108,92,231,0.06);">';
  html += '<div style="display:inline-block;background:' + statusColor + ';color:white;font-size:22px;font-weight:700;padding:10px 32px;border-radius:50px;letter-spacing:1.5px;">' + data.overallStatus + '</div>';
  html += '<p style="font-size:14px;color:' + TEXT_DARK + ';margin:14px 0 4px;">' + overallSummary + '</p>';
  html += '<p style="font-size:12px;color:' + TEXT_MUTED + ';margin:0;">Field cloud-free coverage: <strong>' + data.fieldCoveragePercent + '%</strong></p>';
  html += '</div>';

  var healthyCount = 0;
  var stressedCount = 0;
  var naCount = 0;

  for (var c = 0; c < data.indices.length; c++) {
    if (data.indices[c].mean == null) {
      naCount++;
    } else if (data.indices[c].stressed) {
      stressedCount++;
    } else {
      healthyCount++;
    }
  }

  html += '<div style="display:flex;gap:10px;margin:0 16px 16px;">';
  html += '<div style="flex:1;background:white;border-radius:12px;border:1px solid ' + CARD_BORDER + ';padding:14px;text-align:center;">';
  html += '<div style="font-size:11px;color:' + TEXT_MUTED + ';margin-bottom:4px;">Healthy</div>';
  html += '<div style="font-size:20px;font-weight:700;color:#27ae60;">' + healthyCount + '</div></div>';
  html += '<div style="flex:1;background:' + BRAND_PURPLE + ';border-radius:12px;padding:14px;text-align:center;">';
  html += '<div style="font-size:11px;color:#E4E1FA;margin-bottom:4px;">Stressed</div>';
  html += '<div style="font-size:20px;font-weight:700;color:white;">' + stressedCount + '</div></div>';
  html += '<div style="flex:1;background:white;border-radius:12px;border:1px solid ' + CARD_BORDER + ';padding:14px;text-align:center;">';
  html += '<div style="font-size:11px;color:' + TEXT_MUTED + ';margin-bottom:4px;">N/A</div>';
  html += '<div style="font-size:20px;font-weight:700;color:' + TEXT_DARK + ';">' + naCount + '</div></div>';
  html += '</div>';

  html += '<div style="margin:0 16px 16px;background:white;border-radius:14px;border:1px solid ' + CARD_BORDER + ';overflow:hidden;">';
  html += '<div style="padding:16px 18px 8px;font-size:14px;font-weight:600;color:' + TEXT_DARK + ';">Detailed Index Results</div>';
  html += '<table style="width:100%;border-collapse:collapse;font-size:13px;">';
  html += '<tr style="background:' + BG_LIGHT + ';text-align:left;">';
  html += '<th style="padding:10px 12px;color:' + TEXT_MUTED + ';">Index</th>';
  html += '<th style="padding:10px 8px;color:' + TEXT_MUTED + ';">Mean</th>';
  html += '<th style="padding:10px 8px;color:' + TEXT_MUTED + ';">Min</th>';
  html += '<th style="padding:10px 8px;color:' + TEXT_MUTED + ';">Max</th>';
  html += '<th style="padding:10px 8px;color:' + TEXT_MUTED + ';">Std Dev</th>';
  html += '<th style="padding:10px 8px;color:' + TEXT_MUTED + ';">Stressed Area</th>';
  html += '<th style="padding:10px 12px;color:' + TEXT_MUTED + ';">Status</th>';
  html += '</tr>';

  for (var i = 0; i < data.indices.length; i++) {
    var item = data.indices[i];
    var rowBg = '#ffffff';
    if (i % 2 != 0) rowBg = BG_LIGHT;

    if (item.mean == null) {
      html += '<tr style="background:' + rowBg + ';">';
      html += '<td style="padding:10px 12px;font-weight:600;color:' + TEXT_DARK + ';">' + item.name + '</td>';
      html += '<td colspan="5" style="padding:10px 8px;color:' + TEXT_MUTED + ';font-style:italic;">N/A — sensor in use lacks required band</td>';
      html += '<td style="padding:10px 12px;color:' + TEXT_MUTED + ';">—</td></tr>';
      continue;
    }

    var pillColor = '#27ae60';
    var pillText = 'Healthy';
    if (item.stressed) {
      pillColor = '#e74c3c';
      pillText = 'Stressed';
    }

    html += '<tr style="background:' + rowBg + ';">';
    html += '<td style="padding:10px 12px;font-weight:600;color:' + TEXT_DARK + ';">' + item.name + '</td>';
    html += '<td style="padding:10px 8px;color:' + TEXT_DARK + ';">' + item.mean + '</td>';
    html += '<td style="padding:10px 8px;color:' + TEXT_DARK + ';">' + item.min + '</td>';
    html += '<td style="padding:10px 8px;color:' + TEXT_DARK + ';">' + item.max + '</td>';
    html += '<td style="padding:10px 8px;color:' + TEXT_DARK + ';">' + item.stdDev + '</td>';
    html += '<td style="padding:10px 8px;color:' + TEXT_DARK + ';">' + item.percentStressed + '%</td>';
    html += '<td style="padding:10px 12px;"><span style="background:' + pillColor + ';color:white;padding:3px 12px;border-radius:14px;font-size:11px;font-weight:600;">' + pillText + '</span></td>';
    html += '</tr>';
  }

  html += '</table></div>';

  html += '<div style="margin:0 16px 16px;background:white;border-radius:14px;border:1px solid ' + CARD_BORDER + ';padding:16px 18px;">';
  html += '<div style="font-size:14px;font-weight:600;color:' + TEXT_DARK + ';margin:0 0 12px;">What This Means</div>';

  for (var j = 0; j < data.indices.length; j++) {
    var idx = data.indices[j];
    if (idx.mean == null) continue;

    var borderColor = BRAND_PURPLE;
    if (idx.stressed) borderColor = '#e74c3c';

    html += '<div style="border-left:4px solid ' + borderColor + ';padding:8px 14px;margin-bottom:8px;background:' + BG_LIGHT + ';border-radius:6px;">';
    html += '<strong style="font-size:13px;color:' + TEXT_DARK + ';">' + idx.name + ' — ' + idx.fullName + ':</strong> ';
    html += '<span style="font-size:13px;color:' + TEXT_MUTED + ';">' + idx.explanation + '</span></div>';
  }

  html += '</div>';

  html += '<div style="background:' + BRAND_PURPLE_DARK + ';padding:22px 24px;text-align:center;">';
  html += '<p style="color:#E4E1FA;font-size:12px;margin:0 0 10px;">Auto-generated from satellite data on ' + data.reportDate + '</p>';
  html += '<div style="height:1px;background:rgba(255,255,255,0.15);margin:0 0 12px;"></div>';
  html += '<p style="color:white;font-size:14px;font-weight:700;margin:0 0 4px;">Wali Solutions</p>';
  html += '<p style="color:#FFFFFF;font-size:12px;margin:0;"> +92 331 7353571 &nbsp;·&nbsp; <a href="mailto:waleedawan5598@gmail.com" style="color:#FFFFFF;text-decoration:none;">waleedawan5598@gmail.com</a></p>';
  html += '<p style="color:#B8B4E8;font-size:10px;margin:10px 0 0;">Powered by Google Earth Engine</p>';
  html += '</div></div>';

  return html;
}

// Main function - runs every week
function checkAndSendReport() {
  Logger.log('Checking folder...');

  var summaryFiles = getAllSummaryFiles();

  if (summaryFiles.length === 0) {
    Logger.log('No summary files found, skipping this run');
    return;
  }

  Logger.log(summaryFiles.length + ' summary file(s) found. Sending one email per file.');

  for (var f = 0; f < summaryFiles.length; f++) {
    var file = summaryFiles[f];

    var data = readSummaryFile(file);
    var emailHTML = buildEmail(data);

    GmailApp.sendEmail(
      RECIPIENT_EMAIL,
      '[' + data.overallStatus + '] Crop Health Report - ' + data.reportDate,
      'Open this email in HTML mode to view the report.',
      { htmlBody: emailHTML, name: SENDER_NAME }
    );

    Logger.log('Email sent for file: ' + file.getName());

    // Delete this file now that its email has been sent
    file.setTrashed(true);
  }

  Logger.log('All summary files processed and emails sent.');
}

// Run once to set up the weekly trigger
function setupTrigger() {
  ScriptApp.newTrigger('checkAndSendReport')
    .timeBased()
    .everyWeeks(1)
    .onWeekDay(ScriptApp.WeekDay.MONDAY)
    .create();

  Logger.log('Trigger created - will run every week');
}