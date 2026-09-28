const XLSX = require('xlsx');
const assert = require('assert');

// 1. Create a simulated workbook with multi-row headers and "Particulars" column
const titleChartData = [
  ['P & P Enterprises - Attendance Muster Roll'],
  ['Month: March 2026', '', 'Site: Pune Plant'],
  ['Sr No', 'Emp No', 'Particulars', 'Category', 'Site', 'Present Days', 'OT Hours', 'OT Rate'],
  [1, 'EMP-0001', 'Rahul Patil', 'Skilled', 'Pune Plant', 24, 4, 120],
  [2, 'EMP-0002', 'Amit Jadhav', 'Skilled', 'Pune Plant', 26, 0, 0],
  [3, 'EMP-0023', 'Sunil Deshmukh', 'Semi-skilled', 'Pune Plant', 22, 6, 110], // New employee
  ['Total', '', '', '', '', 72, 10, '']
];

const wb = XLSX.utils.book_new();
const ws1 = XLSX.utils.aoa_to_sheet(titleChartData);
XLSX.utils.book_append_sheet(wb, ws1, 'MusterRoll');

// 2. Create a date-wise attendance chart sheet
const dateChartData = [
  ['Monthly Attendance Chart'],
  ['Sr No', 'Code', 'Employee / Particulars', 'Skill', 'Location', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'OT'],
  [1, 'EMP-0001', 'Rahul Patil', 'Skilled', 'Pune Plant', 'P', 'P', 'P', 'P', 'P', 'P', 'WO', 'P', 'HD', 'P', 2],
  [2, 'EMP-0099', 'Kavita Joshi', 'Skilled', 'Pune Plant', 'P', 'P', 'P', 'P', 'CL', 'P', 'WO', 'P', 'P', 'P', 0] // New employee
];
const ws2 = XLSX.utils.aoa_to_sheet(dateChartData);
XLSX.utils.book_append_sheet(wb, ws2, 'DateWiseChart');

// Read back via XLSX as main.cjs does
const sheets = wb.SheetNames.map(name => ({
  name,
  rows: XLSX.utils.sheet_to_json(wb.Sheets[name], { defval: '' }),
  rawRows: XLSX.utils.aoa_to_sheet ? XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '' }) : []
}));

// Load extraction logic from app.js definitions
function detectAttendanceColMap(headers) {
  const map = {
    code: -1,
    name: -1,
    category: -1,
    site: -1,
    workingDays: -1,
    presentDays: -1,
    payableDays: -1,
    weeklyOffs: -1,
    paidHolidays: -1,
    cl: -1,
    pl: -1,
    sickLeave: -1,
    lopDays: -1,
    otHours: -1,
    otRate: -1,
    uan: -1,
    pan: -1,
    aadhaar: -1,
    department: -1,
    designation: -1,
    srNo: -1,
    dateCols: []
  };

  headers.forEach((h, idx) => {
    const val = String(h || '').trim();
    if (!val) return;
    const lower = val.toLowerCase();

    const dayMatch = lower.match(/^(?:day\s*)?([1-9]|[12][0-9]|3[01])$/);
    if (dayMatch) {
      map.dateCols.push({ day: parseInt(dayMatch[1], 10), idx });
      return;
    }

    const isEmpCode = /^(?:emp(?:loyee)?\s*(?:code|no|num|number)|token(?:\s*no)?|card\s*no|badge|attendance\s*no|^code$|^empcode$|^emp_code$|^emp_no$)/i.test(val);
    const isSrNo = /^(?:sr\.?\s*no|s\.?\s*no|serial\s*no)$/i.test(val);

    if (map.name === -1 && /(?:emp(?:loyee)?[\s/_-]*(?:name|particulars)|particulars|worker[\s_-]*name|staff[\s_-]*name|name\s*of|full[\s_-]*name|^name$)/i.test(val)) {
      map.name = idx;
    } else if (isEmpCode) {
      map.code = idx;
    } else if (isSrNo && map.code === -1) {
      map.srNo = idx;
    } else if (map.category === -1 && /^(?:category|skill(?:ed)?|designation|cadre|grade|role|type)$/i.test(val)) {
      map.category = idx;
    } else if (map.site === -1 && /^(?:site(?:\s*name|\s*code)?|location|plant|unit|branch|project)$/i.test(val)) {
      map.site = idx;
    } else if (map.presentDays === -1 && /^(?:present\s*days?|total\s*present|total\s*days?|duty\s*days?|p[\s_-]*days?|days\s*worked|^present$|^days$|^pr$)$/i.test(val)) {
      map.presentDays = idx;
    } else if (map.payableDays === -1 && /^(?:payable\s*days?|pay\s*days?|paid\s*days?)$/i.test(val)) {
      map.payableDays = idx;
    } else if (map.workingDays === -1 && /^(?:working\s*days?|total\s*working|month\s*days?|calendar\s*days?)$/i.test(val)) {
      map.workingDays = idx;
    } else if (map.otHours === -1 && /^(?:ot\s*(?:hours?|hrs?|days?)|overtime\s*(?:hours?|hrs?|days?)|^ot$|o\.t\.)$/i.test(val)) {
      map.otHours = idx;
    } else if (map.otRate === -1 && /^(?:ot\s*rate|overtime\s*rate|hourly\s*rate)$/i.test(val)) {
      map.otRate = idx;
    } else if (map.designation === -1 && /^(?:designation|post|role)$/i.test(val)) {
      map.designation = idx;
    }
  });

  if (map.code === -1 && map.srNo !== -1) {
    map.code = map.srNo;
  }

  return map;
}

function extractAttendanceRecordFromRawRow(row, colMap) {
  const getCell = (idx) => (idx !== -1 && row[idx] !== undefined && row[idx] !== null) ? String(row[idx]).trim() : '';
  const getNum = (idx, fallback = 0) => {
    if (idx === -1 || row[idx] === undefined || row[idx] === null || row[idx] === '') return fallback;
    const n = Number(row[idx]);
    return isNaN(n) ? fallback : n;
  };

  const rawCode = getCell(colMap.code);
  const rawName = getCell(colMap.name);
  const rawCategory = getCell(colMap.category) || 'Skilled';
  const rawSite = getCell(colMap.site);

  let workingDays = getNum(colMap.workingDays, 26);
  let presentDays = getNum(colMap.presentDays, -1);
  let payableDays = getNum(colMap.payableDays, -1);
  let weeklyOffs = getNum(colMap.weeklyOffs, 0);
  let otHours = getNum(colMap.otHours, 0);
  let otRate = getNum(colMap.otRate, 0);

  if (Array.isArray(colMap.dateCols) && colMap.dateCols.length > 0) {
    let datePresent = 0;
    let dateWo = 0;
    colMap.dateCols.forEach(d => {
      const val = String(row[d.idx] || '').trim().toUpperCase();
      if (!val) return;
      if (val === 'P' || val === 'PR' || val === '1' || val === 'PRESENT') datePresent += 1;
      else if (val === 'HD' || val === '0.5') datePresent += 0.5;
      else if (val === 'WO' || val === 'W' || val === 'OFF') dateWo += 1;
    });
    if (presentDays === -1) presentDays = datePresent;
    if (weeklyOffs === 0 && dateWo > 0) weeklyOffs = dateWo;
  }

  if (presentDays === -1) presentDays = 26;
  if (payableDays === -1) payableDays = presentDays;

  return { rawCode, rawName, rawCategory, rawSite, workingDays, presentDays, payableDays, weeklyOffs, otHours, otRate };
}

function parseAttendanceSpreadsheet(sheet) {
  let records = [];
  const raw = sheet.rawRows;
  let headerRowIdx = -1;
  let bestScore = 0;

  for (let r = 0; r < Math.min(15, raw.length); r++) {
    const row = raw[r];
    if (!Array.isArray(row)) continue;
    let score = 0;
    let hasNameOrParticulars = false;
    let hasCode = false;
    let hasDaysOrPresent = false;

    row.forEach(cell => {
      if (!cell) return;
      const str = String(cell).trim().toLowerCase();
      if (/(?:emp(?:loyee)?[\s/_-]*(?:name|particulars)|particulars|worker[\s_-]*name|staff[\s_-]*name|name\s*of|full[\s_-]*name|^name$)/i.test(str)) {
        hasNameOrParticulars = true;
        score += 4;
      } else if (/(?:emp(?:loyee)?[\s/_-]*(?:code|no|num|number)|token(?:\s*no)?|card\s*no|badge|attendance\s*no|^code$)/i.test(str)) {
        hasCode = true;
        score += 3;
      } else if (/(?:present\s*days?|total\s*present|total\s*days?|duty\s*days?|p[\s_-]*days?|days\s*worked|^present$|^days$|^pr$)/i.test(str)) {
        hasDaysOrPresent = true;
        score += 3;
      } else if (/^(?:[1-9]|[12][0-9]|3[01])$/.test(str)) {
        score += 1;
      }
    });

    if ((hasNameOrParticulars || (hasCode && (hasDaysOrPresent || score >= 5))) && score > bestScore) {
      bestScore = score;
      headerRowIdx = r;
    }
  }

  if (headerRowIdx === -1) headerRowIdx = 0;
  const headers = (raw[headerRowIdx] || []).map(h => String(h || '').trim());
  const colMap = detectAttendanceColMap(headers);

  for (let r = headerRowIdx + 1; r < raw.length; r++) {
    const row = raw[r];
    if (!Array.isArray(row) || row.length === 0) continue;
    const firstNonEmpty = row.find(c => c !== undefined && c !== null && String(c).trim() !== '');
    if (!firstNonEmpty) continue;
    const firstStr = String(firstNonEmpty).trim().toLowerCase();
    if (/^(total|grand\s*total|sub\s*total|summary)/i.test(firstStr)) continue;

    const rec = extractAttendanceRecordFromRawRow(row, colMap);
    if (rec && (rec.rawName || rec.rawCode)) {
      records.push(rec);
    }
  }
  return records;
}

function matchAttendanceWithEmployees(records, employees, sites) {
  const emps = employees || [];
  const siteList = sites || [];

  return records.map((rec, idx) => {
    let matchedEmp = null;
    let matchReason = '';
    const recCode = (rec.rawCode || '').trim();
    const recName = (rec.rawName || '').trim();

    // 1. Code match
    if (recCode) {
      matchedEmp = emps.find(e => {
        const ec = (e.empCode || '').trim().toUpperCase();
        const rc = recCode.toUpperCase();
        if (ec === rc) return true;
        const ecDigits = ec.replace(/\D/g, '');
        const rcDigits = rc.replace(/\D/g, '');
        return ecDigits && rcDigits && ecDigits === rcDigits;
      });
      if (matchedEmp) matchReason = 'Code';
    }

    // 2. Name match
    if (!matchedEmp && recName) {
      matchedEmp = emps.find(e => (e.name || '').toLowerCase().trim() === recName.toLowerCase().trim());
      if (matchedEmp) matchReason = 'Name';
    }

    const isExisting = Boolean(matchedEmp);
    return {
      ...rec,
      rowIdx: idx + 1,
      empCode: matchedEmp ? matchedEmp.empCode : recCode,
      name: matchedEmp ? matchedEmp.name : recName,
      category: matchedEmp?.category || rec.rawCategory || 'Skilled',
      matchType: isExisting ? 'existing' : 'new',
      matchReason,
      matchedEmployee: matchedEmp
    };
  });
}

// Existing Employee Master
const mockEmployees = [
  { empCode: 'EMP-0001', name: 'Rahul Patil', category: 'Skilled', siteId: 'PUNE01', basic: 18500 },
  { empCode: 'EMP-0002', name: 'Amit Jadhav', category: 'Skilled', siteId: 'PUNE01', basic: 24000 }
];
const mockSites = [
  { id: 'PUNE01', siteCode: 'PUNE01', siteName: 'Pune Plant' }
];

console.log('--- TEST 1: Parsing Sheet with Title Header & Particulars ---');
const parsed1 = parseAttendanceSpreadsheet(sheets[0]);
console.log('Parsed Rows Count:', parsed1.length);
assert.strictEqual(parsed1.length, 3, 'Should parse 3 employee rows (excluding Total row)');
assert.strictEqual(parsed1[0].rawName, 'Rahul Patil', 'Row 0 name must be Rahul Patil');
assert.strictEqual(parsed1[0].rawCode, 'EMP-0001', 'Row 0 code must be EMP-0001');
assert.strictEqual(parsed1[0].presentDays, 24, 'Row 0 present days must be 24');
assert.strictEqual(parsed1[0].otHours, 4, 'Row 0 OT hours must be 4');
assert.strictEqual(parsed1[0].otRate, 120, 'Row 0 OT rate must be 120');

console.log('--- TEST 2: Matching Against Employee Master ---');
const matched1 = matchAttendanceWithEmployees(parsed1, mockEmployees, mockSites);
console.log('Row 0:', matched1[0].empCode, matched1[0].name, matched1[0].matchType);
console.log('Row 1:', matched1[1].empCode, matched1[1].name, matched1[1].matchType);
console.log('Row 2:', matched1[2].empCode, matched1[2].name, matched1[2].matchType);

assert.strictEqual(matched1[0].matchType, 'existing', 'Row 0 must be Existing');
assert.strictEqual(matched1[0].name, 'Rahul Patil', 'Row 0 name must be actual name from master');
assert.notStrictEqual(matched1[0].name, 'Employee EMP-0001', 'Must not be placeholder name');

assert.strictEqual(matched1[1].matchType, 'existing', 'Row 1 must be Existing');
assert.strictEqual(matched1[2].matchType, 'new', 'Row 2 (EMP-0023 Sunil Deshmukh) must be New Employee');
assert.strictEqual(matched1[2].name, 'Sunil Deshmukh', 'New employee name must be captured from sheet');

console.log('--- TEST 3: Parsing Date-wise Chart (Day 1..10) ---');
const parsed2 = parseAttendanceSpreadsheet(sheets[1]);
console.log('Datewise Rows Count:', parsed2.length);
assert.strictEqual(parsed2.length, 2, 'Should parse 2 date-wise rows');
assert.strictEqual(parsed2[0].rawName, 'Rahul Patil');
// Day 1..10 has 8 P, 1 HD (0.5), 1 WO -> 8.5 present days
assert.strictEqual(parsed2[0].presentDays, 8.5, 'Present days should sum P + 0.5 for HD');
assert.strictEqual(parsed2[0].otHours, 2, 'OT hours should be 2');

const matched2 = matchAttendanceWithEmployees(parsed2, mockEmployees, mockSites);
assert.strictEqual(matched2[0].matchType, 'existing');
assert.strictEqual(matched2[1].matchType, 'new');
assert.strictEqual(matched2[1].name, 'Kavita Joshi');

console.log('--- TEST 4: Zero Overwriting of Employee Master ---');
// Verify Rahul Patil's master data was not touched
assert.strictEqual(mockEmployees[0].basic, 18500, 'Master basic salary must not be changed');
assert.strictEqual(mockEmployees[0].siteId, 'PUNE01', 'Master siteId must not be changed');

console.log('--- TEST 5: Dynamic In-Memory Master Registration & Re-linking ---');
// Simulate user clicking "Add Employee" for Sunil Deshmukh (EMP-0023)
const newEmpRecord = {
  empCode: matched1[2].empCode,
  name: matched1[2].name,
  category: matched1[2].category,
  siteId: 'PUNE01',
  basic: 16000
};
mockEmployees.push(newEmpRecord);

// Re-run matching against updated mockEmployees
const reMatched = matchAttendanceWithEmployees(parsed1, mockEmployees, mockSites);
assert.strictEqual(reMatched[2].matchType, 'existing', 'Sunil Deshmukh must now be recognized as existing');
assert.strictEqual(reMatched[2].presentDays, 22, 'Attendance present days preserved without re-upload');
assert.strictEqual(reMatched[2].otHours, 6, 'Attendance OT hours preserved without re-upload');
assert.strictEqual(reMatched[2].otRate, 110, 'Attendance OT rate preserved without re-upload');

console.log('--- TEST 6: Row-Level Ignore and Selective Import Filtering ---');
const ignoredSet = new Set(['EMP-0099']);
const filteredForImport = matched2.filter(r => r.matchType === 'existing' && !ignoredSet.has(r.empCode));
assert.strictEqual(filteredForImport.length, 1, 'Only existing non-ignored records should be imported');
assert.strictEqual(filteredForImport[0].empCode, 'EMP-0001');

console.log('--- ALL TEST SUITE ASSERTIONS PASSED! 100% COMPLIANT. ---');
