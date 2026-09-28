# EMPPAY Desktop Payroll

EMPPAY is a standalone Windows desktop payroll application. It stores its working data locally in the Electron user-data directory and does not require browser OAuth.

## Run in development

Install Node.js 22 LTS or newer, then open PowerShell in this folder:

```powershell
npm install
npm run dev
```

The application opens as a desktop window. Data is stored locally by Electron. Use **Backup now** to save a portable JSON backup file.

## Build a Windows installer

On Windows, run:

```powershell
npm install
npm run build:win
```

The installer will be generated in the `dist` folder. Run the resulting installer and launch **EMPPAY Payroll** from the Start Menu.

## Main workflow

Import an Excel workbook from **Import Excel**. The first worksheet is read and common columns such as Employee, Emp Code, Basic, DA, HRA, Category, Working Days, Payable Days, OT Hours, and OT Rate are recognized. Review or edit the attendance values under **Attendance & OT**, configure statutory rules under **Payroll Rules**, then open **Payroll Run** to calculate gross salary, PF, ESIC, PT, LWF/MLWF, deductions, and net pay. Finalize the run to preserve an immutable local snapshot. Use **Payslips**, **Wage Register & Reports**, and **Backup & History** for outputs and recovery.

## Important limitation

This package is a desktop source/build package. A Windows installer should be built on Windows using `npm run build:win`, because the development sandbox is Linux. The local payroll database is intentionally stored on the user’s computer and should be backed up regularly to a separate drive.
