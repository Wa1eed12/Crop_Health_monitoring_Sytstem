# Crop Health Monitoring System

Automated satellite-based crop health monitoring that combines Google Earth Engine
analysis with email reporting via Google Apps Script.

## What it does

- Pulls multispectral satellite imagery (Sentinel-2, Landsat 9, Landsat 8, MODIS) for a
  defined field boundary, with automatic fallback between sensors and time windows if
  cloud cover blocks the primary source
- Calculates 7 vegetation/health indices: NDVI, EVI, NDRE, GNDVI, NDMI, SAVI, and MSAVI
- Flags stressed areas against configurable per-index thresholds and classifies overall
  field status as HEALTHY, WARNING, or CRITICAL
- Exports a timestamped summary CSV (with embedded JSON) to Google Drive each time the
  script is run
- A companion Google Apps Script checks the Drive folder weekly, processes **every**
  summary file found (since the field may be checked more than once per week), and
  sends a separate formatted HTML email report for each one

## Components

- `GEE/gee_script.js` — Earth Engine script. Edit the CONFIG block at the top to change
  the field boundary, sensor priority, thresholds, or output settings. Must be run
  manually in the Earth Engine Code Editor; each run creates an export task that needs
  to be confirmed in the Tasks panel.
- `Email_script/email_script.gs` — Google Apps Script that scans the Drive output
  folder, reads every summary file present, builds a formatted HTML email per file, and
  sends them via Gmail. Runs on a weekly time-based trigger.

## Setup

1. Paste `gee_script.js` into the [Earth Engine Code Editor](https://code.earthengine.google.com/),
   update `FIELD_COORDS` to your field's polygon, and run it whenever you want a new
   report generated. Click **RUN** on the resulting task in the Tasks panel to actually
   produce the file.
2. Paste `email_script.gs` into a Google Apps Script project bound to the same Drive
   account, set your recipient email, and run `setupTrigger()` once to create a weekly
   trigger that calls `checkAndSendReport()`.

## Notes

- Each GEE run produces a uniquely timestamped CSV (e.g. `summary_2026-06-27_1430.csv`),
  so multiple exports in the same week won't overwrite each other.
- The email script sends one email per summary file found, then deletes that file once
  its email is sent.
- Most customization (crop type, thresholds, sensors, field geometry) only requires
  editing the CONFIG block at the top of `gee_script.js`.