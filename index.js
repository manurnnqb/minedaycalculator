// Get all IANA timezones from browser, or use fallback list
// Also normalize legacy names to modern equivalents
const TIMEZONE_ALIASES = {
    'Asia/Calcutta': 'Asia/Kolkata',
    'Asia/Saigon': 'Asia/Ho_Chi_Minh',
    'Asia/Katmandu': 'Asia/Kathmandu',
    'Asia/Rangoon': 'Asia/Yangon',
    'Europe/Kiev': 'Europe/Kyiv',
    'Pacific/Ponape': 'Pacific/Pohnpei',
    'Pacific/Truk': 'Pacific/Chuuk',
    'Atlantic/Faeroe': 'Atlantic/Faroe'
};

const TIMEZONES = (() => {
    try {
        if (typeof Intl !== 'undefined' && typeof Intl.supportedValuesOf === 'function') {
            const rawList = Intl.supportedValuesOf('timeZone');
            // Replace legacy names with modern ones
            const normalized = rawList.map(tz => TIMEZONE_ALIASES[tz] || tz);
            // Remove duplicates and sort
            return [...new Set(normalized)].sort();
        }
    } catch (e) { }
    // Fallback for older browsers
    return [
        'UTC',
        'Africa/Cairo', 'Africa/Johannesburg',
        'America/Argentina/Buenos_Aires', 'America/Bogota', 'America/Chicago',
        'America/Denver', 'America/Halifax', 'America/Lima', 'America/Los_Angeles',
        'America/Mexico_City', 'America/New_York', 'America/Sao_Paulo',
        'America/St_Johns', 'America/Toronto', 'America/Vancouver',
        'Asia/Bangkok', 'Asia/Dhaka', 'Asia/Dubai', 'Asia/Hong_Kong',
        'Asia/Kolkata', 'Asia/Mumbai', 'Asia/Seoul', 'Asia/Shanghai',
        'Asia/Singapore', 'Asia/Tokyo',
        'Australia/Melbourne', 'Australia/Perth', 'Australia/Sydney',
        'Europe/Amsterdam', 'Europe/Berlin', 'Europe/London', 'Europe/Madrid',
        'Europe/Moscow', 'Europe/Paris', 'Europe/Rome', 'Europe/Stockholm',
        'Pacific/Auckland'
    ];
})();

// Live clock update timer (self-correcting; aligned to real second boundaries)
let updateInterval = null; // setTimeout id
let isLiveTicking = false;
let selectedTimezone = '';
let selectedAnchorTime = '00:00';
let highlightedIndex = -1;
let highlightedAnchorIndex = -1;

let isSimulatedTimeActive = false;
let simulatedUtcDate = null; // Date in UTC representing simulated moment
// Wall-clock date/time chosen by user in the picker (interpreted in selectedTimezone).
// Used to preserve the chosen edit date/time when timezone changes.
let simulatedWallClock = null; // { year, month, day, hour, minute }

// Populate anchor time dropdown (00:00 to 23:30 in 30-minute intervals)
function populateAnchorTimes() {
    const list = document.getElementById('anchor_list');
    const input = document.getElementById('anchor_input');

    // Restore persisted anchor time if available
    let persistedAnchor = null;
    try {
        persistedAnchor = localStorage.getItem('mineDaySelectedAnchorTime');
    } catch (e) { }
    selectedAnchorTime = persistedAnchor || '00:00';
    input.value = selectedAnchorTime;

    // Populate list
    for (let hour = 0; hour < 24; hour++) {
        for (let minute of [0, 30]) {
            const timeStr = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
            const item = document.createElement('div');
            item.className = 'dropdown-item';
            if (timeStr === selectedAnchorTime) {
                item.classList.add('selected');
            }
            item.textContent = timeStr;
            item.dataset.value = timeStr;

            item.addEventListener('mousedown', function (e) {
                e.preventDefault();
                selectAnchorTime(timeStr);
                closeAnchorDropdown();
            });

            item.addEventListener('mouseenter', function () {
                highlightAnchorItem(Array.from(list.children).indexOf(item));
            });

            list.appendChild(item);
        }
    }
}

// Select anchor time
function selectAnchorTime(time) {
    const input = document.getElementById('anchor_input');
    const list = document.getElementById('anchor_list');
    selectedAnchorTime = time;
    input.value = time;
    // Persist selection
    try {
        localStorage.setItem('mineDaySelectedAnchorTime', time);
    } catch (e) { }

    // Update selected class
    list.querySelectorAll('.dropdown-item').forEach(item => {
        item.classList.toggle('selected', item.dataset.value === time);
    });

    updateCalculation(true); // Pass true to trigger flash animation
    startLiveTicker();
}

// Self-correcting timer that aligns updates to the next real second boundary.
// - Always derives time from new Date() inside updateCalculation/calculateMineDay
// - Resynchronizes every tick (no drift)
// - Ensures only one active timer (no double timers)
function startLiveTicker() {
    if (isLiveTicking) return;
    isLiveTicking = true;

    const tick = () => {
        if (!isLiveTicking) return;
        updateCalculation();

        // Schedule next tick to the next exact second boundary.
        const now = Date.now();
        const delay = 1000 - (now % 1000);
        updateInterval = setTimeout(tick, delay);
    };

    // First tick: align to the next second boundary.
    const now = Date.now();
    const delay = 1000 - (now % 1000);
    updateInterval = setTimeout(tick, delay);
}


// Open anchor dropdown
function openAnchorDropdown() {
    const list = document.getElementById('anchor_list');
    list.classList.add('open');

    // Scroll selected item into view
    setTimeout(() => {
        const selected = list.querySelector('.selected');
        if (selected) {
            selected.scrollIntoView({ block: 'nearest' });
        }
    }, 0);
}

// Close anchor dropdown
function closeAnchorDropdown() {
    const list = document.getElementById('anchor_list');
    list.classList.remove('open');
}

// Highlight anchor item by index
function highlightAnchorItem(index) {
    const list = document.getElementById('anchor_list');
    const items = list.querySelectorAll('.dropdown-item');

    items.forEach((item, i) => {
        item.classList.toggle('highlighted', i === index);
    });

    highlightedAnchorIndex = index;
}

// Initialize timezone dropdown
function initTimezoneDropdown() {
    const input = document.getElementById('timezone_input');
    const list = document.getElementById('timezone_list');
    let userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

    // Map legacy timezone names to modern equivalents
    if (TIMEZONE_ALIASES[userTimezone]) {
        userTimezone = TIMEZONE_ALIASES[userTimezone];
    }

    // Restore persisted timezone if available
    let persistedTz = null;
    try {
        persistedTz = localStorage.getItem('mineDaySelectedTimezone');
    } catch (e) { }
    if (persistedTz && TIMEZONES.includes(persistedTz)) {
        selectedTimezone = persistedTz;
        input.value = persistedTz;
    } else if (userTimezone && TIMEZONES.includes(userTimezone)) {
        selectedTimezone = userTimezone;
        input.value = userTimezone;
    } else {
        selectedTimezone = TIMEZONES[0];
        input.value = TIMEZONES[0];
    }

    // Render initial list
    renderDropdownList('');
}

// Render dropdown list based on filter
function renderDropdownList(filter) {
    const list = document.getElementById('timezone_list');
    const filterLower = filter.toLowerCase();

    list.innerHTML = '';
    highlightedIndex = -1;

    const filtered = TIMEZONES.filter(tz =>
        !filter || tz.toLowerCase().includes(filterLower)
    );

    if (filtered.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'dropdown-empty';
        empty.textContent = 'No timezones found';
        list.appendChild(empty);
        return;
    }

    filtered.forEach((tz, index) => {
        const item = document.createElement('div');
        item.className = 'dropdown-item';
        if (tz === selectedTimezone) {
            item.classList.add('selected');
        }

        // Get UTC offset for this timezone
        const offset = getUtcOffset(tz);
        item.innerHTML = `<span class="tz-name">${tz}</span> <span class="tz-offset">(${offset})</span>`;
        item.dataset.value = tz;
        item.dataset.index = index;

        item.addEventListener('mousedown', function (e) {
            e.preventDefault(); // Prevent input blur
            selectTimezone(tz);
            closeDropdown();
        });

        item.addEventListener('mouseenter', function () {
            highlightItem(index);
        });

        list.appendChild(item);
    });
}

// Select a timezone
function selectTimezone(tz) {
    const input = document.getElementById('timezone_input');
    selectedTimezone = tz;
    input.value = tz;
    // Persist selection
    try {
        localStorage.setItem('mineDaySelectedTimezone', tz);
    } catch (e) { }
    updateCalculation(true); // Pass true to trigger flash animation
}

// Open dropdown
function openDropdown() {
    const list = document.getElementById('timezone_list');
    const input = document.getElementById('timezone_input');
    list.classList.add('open');

    // Re-render with current filter
    renderDropdownList(input.value === selectedTimezone ? '' : input.value);

    // Scroll selected item into view
    setTimeout(() => {
        const selected = list.querySelector('.selected');
        if (selected) {
            selected.scrollIntoView({ block: 'nearest' });
        }
    }, 0);
}

// Close dropdown
function closeDropdown() {
    const list = document.getElementById('timezone_list');
    const input = document.getElementById('timezone_input');
    list.classList.remove('open');

    // Restore selected value in input
    input.value = selectedTimezone;
}

// Highlight item by index
function highlightItem(index) {
    const list = document.getElementById('timezone_list');
    const items = list.querySelectorAll('.dropdown-item');

    items.forEach((item, i) => {
        item.classList.toggle('highlighted', i === index);
    });

    highlightedIndex = index;
}

// Format date as DD-MM-YYYY
function formatDate(date) {
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    return `${day}-${month}-${year}`;
}

// Format date as ISO YYYY-MM-DD
function formatIsoDate(date) {
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    return `${year}-${month}-${day}`;
}

// Add days to a date
function addDays(date, days) {
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    return result;
}

// Get minutes since midnight
function getMinutesSinceMidnight(date) {
    return date.getHours() * 60 + date.getMinutes();
}

// Get UTC offset for a timezone (e.g., "UTC+5:30")
function getUtcOffset(timezoneStr) {
    const now = new Date();

    // Get time in UTC
    const utcFormatter = new Intl.DateTimeFormat('en-US', {
        timeZone: 'UTC',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    });

    // Get time in target timezone
    const tzFormatter = new Intl.DateTimeFormat('en-US', {
        timeZone: timezoneStr,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    });

    const utcParts = utcFormatter.formatToParts(now);
    const tzParts = tzFormatter.formatToParts(now);

    const utcDate = new Date(
        utcParts.find(p => p.type === 'year').value,
        utcParts.find(p => p.type === 'month').value - 1,
        utcParts.find(p => p.type === 'day').value,
        utcParts.find(p => p.type === 'hour').value,
        utcParts.find(p => p.type === 'minute').value
    );

    const tzDate = new Date(
        tzParts.find(p => p.type === 'year').value,
        tzParts.find(p => p.type === 'month').value - 1,
        tzParts.find(p => p.type === 'day').value,
        tzParts.find(p => p.type === 'hour').value,
        tzParts.find(p => p.type === 'minute').value
    );

    const diffMinutes = (tzDate - utcDate) / (1000 * 60);
    const sign = diffMinutes >= 0 ? '+' : '-';
    const absMinutes = Math.abs(diffMinutes);
    const hours = Math.floor(absMinutes / 60);
    const minutes = absMinutes % 60;

    if (minutes === 0) {
        return `UTC${sign}${hours}`;
    } else {
        return `UTC${sign}${hours}:${minutes.toString().padStart(2, '0')}`;
    }
}
// Get date-time parts for a given Date in a target timezone
function getDateTimePartsInTimeZone(date, timeZone) {
    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    });
    const parts = formatter.formatToParts(date);
    const get = (t) => parseInt(parts.find(p => p.type === t).value, 10);
    return {
        year: get('year'),
        month: get('month'),
        day: get('day'),
        hour: get('hour'),
        minute: get('minute'),
        second: get('second')
    };
}

// Convert a "wall clock" time in the given timezone to a UTC Date
// (Handles DST by iteratively correcting the guess)
function zonedTimeToUtc(year, month, day, hour, minute, timeZone) {
    // Start with a naive UTC guess matching the components
    let guess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
    for (let i = 0; i < 4; i++) {
        const p = getDateTimePartsInTimeZone(guess, timeZone);
        const desiredUtc = Date.UTC(year, month - 1, day, hour, minute, 0);
        const guessWallAsUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, 0);
        const diffMs = desiredUtc - guessWallAsUtc;
        if (diffMs === 0) break;
        guess = new Date(guess.getTime() + diffMs);
    }
    return guess;
}


// Format time as HH:MM:SS
function formatTime(date) {
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    const seconds = date.getSeconds().toString().padStart(2, '0');
    return `${hours}:${minutes}:${seconds}`;
}

// Convert a local timezone datetime (YYYY-MM-DDTHH:MM) to UTC and format as DD-MM-YYYY HH:MM
function convertToUtc(isoStr, timezoneStr) {
    const [datePart, timePart] = isoStr.split('T');
    const [year, month, day] = datePart.split('-').map(Number);
    const [hour, minute] = timePart.split(':').map(Number);

    const utcDate = zonedTimeToUtc(year, month, day, hour, minute, timezoneStr);

    const utcDay = utcDate.getUTCDate().toString().padStart(2, '0');
    const utcMonth = (utcDate.getUTCMonth() + 1).toString().padStart(2, '0');
    const utcYear = utcDate.getUTCFullYear();
    const utcHour = utcDate.getUTCHours().toString().padStart(2, '0');
    const utcMinute = utcDate.getUTCMinutes().toString().padStart(2, '0');

    return `${utcDay}-${utcMonth}-${utcYear} ${utcHour}:${utcMinute}`;
}

// Calculate mine day based on rules
function calculateMineDay(anchorTimeStr, timezoneStr) {
    const [anchorHour, anchorMinute] = anchorTimeStr.split(':').map(Number);
    const anchorMinutes = anchorHour * 60 + anchorMinute;

    // Get current (or simulated) time in selected timezone
    const now = isSimulatedTimeActive && simulatedUtcDate ? simulatedUtcDate : new Date();
    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: timezoneStr,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    });

    const parts = formatter.formatToParts(now);
    const tzDate = new Date(
        parts.find(p => p.type === 'year').value,
        parts.find(p => p.type === 'month').value - 1,
        parts.find(p => p.type === 'day').value,
        parts.find(p => p.type === 'hour').value,
        parts.find(p => p.type === 'minute').value,
        parts.find(p => p.type === 'second').value
    );

    const currentMinutes = getMinutesSinceMidnight(tzDate);
    const calendarDay = new Date(tzDate.getFullYear(), tzDate.getMonth(), tzDate.getDate());

    let mineDay, mineDayIsoStart, mineDayIsoEnd;

    // Calculate end time as 1 minute before anchor (e.g., 01:00 → 00:59)
    const getEndTime = (anchorH, anchorM) => {
        let endH = anchorH;
        let endM = anchorM - 1;
        if (endM < 0) {
            endM = 59;
            endH = endH - 1;
            if (endH < 0) endH = 23;
        }
        return `${endH.toString().padStart(2, '0')}:${endM.toString().padStart(2, '0')}`;
    };
    const endTimeStr = getEndTime(anchorHour, anchorMinute);

    if (anchorHour === 0 && anchorMinute === 0) {
        // Rule 1: Anchor Time == 00:00 (ISO standard)
        mineDay = calendarDay;
        mineDayIsoStart = `${formatIsoDate(mineDay)}T00:00`;
        mineDayIsoEnd = `${formatIsoDate(mineDay)}T23:59`;
    } else if (anchorHour < 12) {
        // Rule 2: Anchor Time < 12:00 (forward shift)
        if (currentMinutes >= anchorMinutes) {
            mineDay = calendarDay;
        } else {
            mineDay = addDays(calendarDay, -1);
        }
        const mineDayEnd = addDays(mineDay, 1);
        mineDayIsoStart = `${formatIsoDate(mineDay)}T${anchorTimeStr}`;
        // End is 1 minute before anchor on next day
        mineDayIsoEnd = `${formatIsoDate(mineDayEnd)}T${endTimeStr}`;
    } else {
        // Rule 3: Anchor Time >= 12:00 (backward shift, labeled by end date)
        if (currentMinutes >= anchorMinutes) {
            mineDay = addDays(calendarDay, 1);
            const mineDayStart = calendarDay;
            mineDayIsoStart = `${formatIsoDate(mineDayStart)}T${anchorTimeStr}`;
            // End is 1 minute before anchor
            mineDayIsoEnd = `${formatIsoDate(mineDay)}T${endTimeStr}`;
        } else {
            mineDay = calendarDay;
            const mineDayStart = addDays(calendarDay, -1);
            mineDayIsoStart = `${formatIsoDate(mineDayStart)}T${anchorTimeStr}`;
            // End is 1 minute before anchor
            mineDayIsoEnd = `${formatIsoDate(mineDay)}T${endTimeStr}`;
        }
    }

    return {
        mineDay: formatDate(mineDay),
        actualDay: formatDate(tzDate),
        currentTime: formatTime(tzDate),
        utcOffset: getUtcOffset(timezoneStr),
        mineDayIsoStart: mineDayIsoStart,
        mineDayIsoEnd: mineDayIsoEnd,
        tzDate: tzDate,
        anchorHour: anchorHour
    };
}

// Display results
function displayResults(result, shouldFlash = false) {
    // Get all elements that will be updated
    const resultItems = document.querySelectorAll('.result-item');
    const timelineSection = document.getElementById('timelineSection');

    // Only trigger flash animation on user-initiated changes
    if (shouldFlash) {
        resultItems.forEach(item => {
            item.classList.remove('flash-update');
            void item.offsetWidth; // Force reflow to restart animation
            item.classList.add('flash-update');
        });
    }

    document.getElementById('mineDay').textContent = result.mineDay;
    document.getElementById('mineDayTime').textContent = result.currentTime;
    document.getElementById('actualDay').textContent = result.actualDay;
    document.getElementById('actualTime').textContent = result.currentTime;
    document.getElementById('selectedTz').textContent = selectedTimezone;
    document.getElementById('utcOffset').textContent = result.utcOffset;
    document.getElementById('rangeTz').textContent = selectedTimezone;

    const rangeEl = document.getElementById('mineDayRange');
    const rangeUtcEl = document.getElementById('mineDayRangeUtc');

    // Convert ISO format (YYYY-MM-DD) to DD-MM-YYYY HH:MM
    const formatRangeDate = (isoStr) => {
        const [datePart, timePart] = isoStr.split('T');
        const [year, month, day] = datePart.split('-');
        return `${day}-${month}-${year} ${timePart}`;
    };
    const startPretty = formatRangeDate(result.mineDayIsoStart);
    const endPretty = formatRangeDate(result.mineDayIsoEnd);
    rangeEl.innerHTML = `
                <span class="range-chip">${startPretty}</span>
                <span class="range-separator">to</span>
                <span class="range-chip">${endPretty}</span>
            `;

    const startUtc = convertToUtc(result.mineDayIsoStart, selectedTimezone);
    const endUtc = convertToUtc(result.mineDayIsoEnd, selectedTimezone);
    rangeUtcEl.innerHTML = `
                <span class="range-chip">${startUtc}</span>
                <span class="range-separator">to</span>
                <span class="range-chip">${endUtc}</span>
            `;

    // Draw timeline
    drawTimeline(result);

    // Only trigger flash animation on timeline for user-initiated changes
    if (shouldFlash && timelineSection.style.display === 'block') {
        timelineSection.classList.remove('flash-update');
        void timelineSection.offsetWidth; // Force reflow
        timelineSection.classList.add('flash-update');
    }

    document.getElementById('results').classList.add('show');
    document.getElementById('timelineSection').style.display = 'block';
}

// Draw timeline graph
function drawTimeline(result) {
    const canvas = document.getElementById('timelineCanvas');
    const ctx = canvas.getContext('2d');

    // Set canvas size for sharp rendering
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const width = rect.width;
    const height = rect.height;
    const padding = { left: 25, right: 25, top: 30, bottom: 45 };
    const graphWidth = width - padding.left - padding.right;
    const graphHeight = height - padding.top - padding.bottom;

    // Clear canvas
    ctx.clearRect(0, 0, width, height);

    // Get current date in timezone
    const tzDate = result.tzDate;
    const today = new Date(tzDate.getFullYear(), tzDate.getMonth(), tzDate.getDate());

    // Parse mine day range
    const startParts = result.mineDayIsoStart.split('T');
    const endParts = result.mineDayIsoEnd.split('T');
    const mineDayStartDate = new Date(startParts[0]);
    let mineDayEndDate = new Date(endParts[0]);
    const startHour = parseInt(startParts[1].split(':')[0]);
    const startMinute = parseInt(startParts[1].split(':')[1]);
    let endHour = parseInt(endParts[1].split(':')[0]);
    const endMinute = parseInt(endParts[1].split(':')[1]);

    // If end time is 23:59, treat as ending at 00:00 next day for the graph positioning (spans full 24 hours)
    // For other end times (e.g., 00:59 for anchor 01:00), position at anchor time for full 24-hour span
    // But keep original values for label display
    let endMinuteForGraph = endMinute;
    let endHourForGraph = endHour;
    let endDateForGraph = new Date(mineDayEndDate);
    const originalEndHour = endHour;
    const originalEndMinute = endMinute;
    const originalEndDate = new Date(mineDayEndDate);

    // Add 1 minute to get the actual end position (anchor time of next day)
    endMinuteForGraph = endMinute + 1;
    if (endMinuteForGraph >= 60) {
        endMinuteForGraph = 0;
        endHourForGraph = endHour + 1;
        if (endHourForGraph >= 24) {
            endHourForGraph = 0;
            endDateForGraph.setDate(endDateForGraph.getDate() + 1);
        }
    } else {
        endHourForGraph = endHour;
    }

    // Calculate view window: extend 4 hours before mine day start and 4 hours after mine day end for visual clarity
    const viewStartDate = new Date(mineDayStartDate);
    viewStartDate.setHours(startHour - 4, startMinute, 0, 0);
    const viewEndDate = new Date(endDateForGraph);
    viewEndDate.setHours(endHourForGraph + 4, endMinuteForGraph, 0, 0);

    // Total hours to display
    const totalMs = viewEndDate - viewStartDate;
    const totalHours = totalMs / (1000 * 60 * 60);
    const hourWidth = graphWidth / totalHours;

    // Helper: convert date+hour to X position
    function dateTimeToX(date, hour, minute = 0) {
        const targetTime = new Date(date);
        targetTime.setHours(hour, minute, 0, 0);
        const hoursFromStart = (targetTime - viewStartDate) / (1000 * 60 * 60);
        return padding.left + hoursFromStart * hourWidth;
    }

    // Draw mine day highlight (reduced height)
    const highlightStartX = dateTimeToX(mineDayStartDate, startHour, startMinute);
    const highlightEndX = dateTimeToX(endDateForGraph, endHourForGraph, endMinuteForGraph);
    const highlightWidth = highlightEndX - highlightStartX;
    const highlightHeight = 20;
    const highlightY = padding.top + (graphHeight - highlightHeight) / 2;

    ctx.fillStyle = 'rgba(76, 175, 80, 0.35)';
    ctx.fillRect(highlightStartX, highlightY, highlightWidth, highlightHeight);

    ctx.strokeStyle = '#4CAF50';
    ctx.lineWidth = 2;
    ctx.strokeRect(highlightStartX, highlightY, highlightWidth, highlightHeight);

    // Draw timeline axis
    ctx.strokeStyle = '#667';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(padding.left, padding.top + graphHeight);
    ctx.lineTo(width - padding.right, padding.top + graphHeight);
    ctx.stroke();

    // Draw hour markers and labels
    ctx.textAlign = 'center';

    // Iterate through hours in view
    let currentTime = new Date(viewStartDate);
    let lastDateLabel = '';

    while (currentTime <= viewEndDate) {
        const hour = currentTime.getHours();
        const x = dateTimeToX(currentTime, hour);

        // Draw tick mark (taller at midnight)
        const isMidnight = hour === 0;
        ctx.strokeStyle = isMidnight ? '#333' : '#888';
        ctx.lineWidth = isMidnight ? 2 : 1;
        ctx.beginPath();
        ctx.moveTo(x, padding.top + graphHeight);
        ctx.lineTo(x, padding.top + graphHeight + (isMidnight ? 12 : 5));
        ctx.stroke();

        // Draw vertical grid line at midnight
        if (isMidnight) {
            ctx.strokeStyle = '#e0e0e0';
            ctx.lineWidth = 1;
            ctx.setLineDash([3, 3]);
            ctx.beginPath();
            ctx.moveTo(x, padding.top);
            ctx.lineTo(x, padding.top + graphHeight);
            ctx.stroke();
            ctx.setLineDash([]);
        }

        // Draw hour labels for all hours
        ctx.fillStyle = isMidnight ? '#333' : '#444';
        ctx.font = isMidnight ? 'bold 11px Segoe UI, sans-serif' : '10px Segoe UI, sans-serif';
        ctx.fillText(hour.toString().padStart(2, '0'), x, padding.top + graphHeight + 20);

        // Draw date labels at midnight
        if (isMidnight) {
            const dateStr = `${currentTime.getDate().toString().padStart(2, '0')}-${(currentTime.getMonth() + 1).toString().padStart(2, '0')}-${currentTime.getFullYear()}`;
            if (dateStr !== lastDateLabel) {
                ctx.fillStyle = '#1565c0';
                ctx.font = 'bold 11px Segoe UI, sans-serif';
                ctx.fillText(dateStr, x, padding.top + graphHeight + 38);
                lastDateLabel = dateStr;
            }
        }

        // Move to next hour
        currentTime.setHours(currentTime.getHours() + 1);
    }

    // Draw current time marker
    const currentX = dateTimeToX(today, tzDate.getHours(), tzDate.getMinutes());

    if (currentX >= padding.left && currentX <= width - padding.right) {
        ctx.strokeStyle = '#e91e63';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(currentX, padding.top);
        ctx.lineTo(currentX, padding.top + graphHeight);
        ctx.stroke();

        // Draw current time dot
        ctx.fillStyle = '#e91e63';
        ctx.beginPath();
        ctx.arc(currentX, highlightY + highlightHeight / 2, 4, 0, Math.PI * 2);
        ctx.fill();

    }

    // Draw mine day label in the middle of highlight
    const mineDayLabelX = highlightStartX + highlightWidth / 2;
    ctx.fillStyle = '#2e7d32';
    ctx.font = 'bold 11px Segoe UI, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Mine Day: ' + result.mineDay, mineDayLabelX, highlightY - 8);

    // Draw start boundary marker with date
    ctx.strokeStyle = '#2e7d32';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 2]);
    ctx.beginPath();
    ctx.moveTo(highlightStartX, padding.top);
    ctx.lineTo(highlightStartX, padding.top + graphHeight);
    ctx.stroke();
    ctx.setLineDash([]);

    // Start date label (rotated or positioned above)
    const startDateParts = startParts[0].split('-');
    const startDateStr = `${startDateParts[2]}-${startDateParts[1]}-${startDateParts[0]}`;
    const startTimeStr = `${startHour.toString().padStart(2, '0')}:${startMinute.toString().padStart(2, '0')}`;
    ctx.fillStyle = '#1565c0';
    ctx.font = 'bold 10px Segoe UI, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(startDateStr, highlightStartX, padding.top - 5);
    ctx.fillText(startTimeStr, highlightStartX, padding.top + 10);

    // Draw end boundary marker with date
    ctx.strokeStyle = '#2e7d32';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 2]);
    ctx.beginPath();
    ctx.moveTo(highlightEndX, padding.top);
    ctx.lineTo(highlightEndX, padding.top + graphHeight);
    ctx.stroke();
    ctx.setLineDash([]);

    // End date label - use original values for display (show 23:59 not 00:00)
    const endDateStr = `${originalEndDate.getDate().toString().padStart(2, '0')}-${(originalEndDate.getMonth() + 1).toString().padStart(2, '0')}-${originalEndDate.getFullYear()}`;
    const endTimeStr = `${originalEndHour.toString().padStart(2, '0')}:${originalEndMinute.toString().padStart(2, '0')}`;
    ctx.fillStyle = '#1565c0';
    ctx.font = 'bold 10px Segoe UI, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(endDateStr, highlightEndX, padding.top - 5);
    ctx.fillText(endTimeStr, highlightEndX, padding.top + 10);
}

// Update calculation
function updateCalculation(shouldFlash = false) {
    if (selectedAnchorTime && selectedTimezone) {
        const result = calculateMineDay(selectedAnchorTime, selectedTimezone);
        displayResults(result, shouldFlash);
    }
}

const AIRDP_LOCALE_EN = {
  days: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
  daysShort: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  daysMin: ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'],
  months: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
  monthsShort: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  today: 'Today',
  clear: 'Clear',
  dateFormat: 'dd-MM-yyyy',
  timeFormat: 'HH:mm',
  firstDay: 0
};

const timezoneInput = document.getElementById('timezone_input');
const timezoneList = document.getElementById('timezone_list');
const anchorInput = document.getElementById('anchor_input');
const anchorList = document.getElementById('anchor_list');

const editSimTimeBtn = document.getElementById('editSimTimeBtn');
const resetSimTimeBtn = document.getElementById('resetSimTimeBtn');
const simEditor = document.getElementById('simEditor');
const simDateTimePicker = document.getElementById('simDateTimePicker');
const simOkBtn = document.getElementById('simOkBtn');
const simCancelBtn = document.getElementById('simCancelBtn');

// Air Datepicker instance for date/time picker
let airDatepickerInstance = null;

// Initialize Air Datepicker for the simulated time input.
// Note: We still read the value from the input on OK (same pipeline as before).
function setupAirDatepicker() {
  if (airDatepickerInstance) return;

  airDatepickerInstance = new AirDatepicker(simDateTimePicker, {
    timepicker: true,

    dateFormat: 'dd-MM-yyyy',
    timeFormat: 'HH:mm',

    minutesStep: 5,
    autoClose: false,

    locale: AIRDP_LOCALE_EN,

    classes: 'mine-airdp'
  });
}

// Format parts into "dd-mm-yyyy HH:MM"
function formatSimDateTimeValue(parts) {
    const dd = String(parts.day).padStart(2, '0');
    const mm = String(parts.month).padStart(2, '0');
    const yyyy = String(parts.year);
    const HH = String(parts.hour).padStart(2, '0');
    const MM = String(parts.minute).padStart(2, '0');
    return `${dd}-${mm}-${yyyy} ${HH}:${MM}`;
}

// Pick the default wall-clock date/time to show in the editor.
// - If simulated mode is active, use simulatedUtcDate (converted to selectedTimezone wall-clock)
// - Else, use "now" converted to selectedTimezone wall-clock
function getDefaultSimWallClockParts() {
    const baseUtc = (isSimulatedTimeActive && simulatedUtcDate) ? simulatedUtcDate : new Date();
    return getDateTimePartsInTimeZone(baseUtc, selectedTimezone);
}

function openSimEditor() {
    simEditor.style.display = '';
    setupAirDatepicker();

    const parts = getDefaultSimWallClockParts();

    // Set the input value (source of truth for OK click)
    simDateTimePicker.value = formatSimDateTimeValue(parts);

    // Also set the picker UI to match the input value (Date object is constructed in local TZ intentionally)
    const localDisplayDate = new Date(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, 0, 0);
    airDatepickerInstance.selectDate(localDisplayDate, { silent: true });

    // Ensure picker is visible when editor opens
    airDatepickerInstance.show();

    simDateTimePicker.focus();
}

function closeSimEditor() {
    simEditor.style.display = 'none';
    if (airDatepickerInstance) {
        airDatepickerInstance.hide();
    }
}

function setSimulatedTimeFromInputs() {
    // Read value from the input (pipeline must stay identical)
    const val = simDateTimePicker.value;
    if (!val) return;

    const [datePart, timePart] = val.split(' ');
    if (!datePart || !timePart) return;

    // datePart is dd-mm-yyyy
    const [day, month, year] = datePart.split('-').map(Number);
    const [hour, minute] = timePart.split(':').map(Number);

    // Convert wall-clock in selectedTimezone to UTC
    simulatedUtcDate = zonedTimeToUtc(year, month, day, hour, minute, selectedTimezone);

    // Preserve the chosen wall-clock time so timezone changes can re-run the pipeline identically
    simulatedWallClock = { year, month, day, hour, minute };

    isSimulatedTimeActive = true;
    closeSimEditor();
    updateCalculation(true);
    resetSimTimeBtn.style.display = '';
}

function resetSimulatedTime(shouldRecalc = true) {
  isSimulatedTimeActive = false;
  simulatedUtcDate = null;
  simulatedWallClock = null;

  resetSimTimeBtn.style.display = 'none';

  closeSimEditor();

  if (shouldRecalc) {
    try {
      updateCalculation(true);
    } catch (err) {
      console.error('updateCalculation failed after reset:', err);
    }
  }
}


// Click on input opens dropdown and selects all text
timezoneInput.addEventListener('click', function () {
    this.select();
    if (!timezoneList.classList.contains('open')) {
        openDropdown();
    }
});

// Focus on input opens dropdown and selects all text
timezoneInput.addEventListener('focus', function () {
    this.select();
    openDropdown();
});

// Typing filters the list
timezoneInput.addEventListener('input', function () {
    renderDropdownList(this.value);
    if (!timezoneList.classList.contains('open')) {
        openDropdown();
    }
});

// Blur closes dropdown
timezoneInput.addEventListener('blur', function () {
    // Small delay to allow click on item to register
    setTimeout(closeDropdown, 150);
});

// Keyboard navigation
timezoneInput.addEventListener('keydown', function (e) {
    const items = timezoneList.querySelectorAll('.dropdown-item');

    if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (!timezoneList.classList.contains('open')) {
            openDropdown();
        } else {
            const newIndex = Math.min(highlightedIndex + 1, items.length - 1);
            highlightItem(newIndex);
            items[newIndex]?.scrollIntoView({ block: 'nearest' });
        }
    } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (timezoneList.classList.contains('open')) {
            const newIndex = Math.max(highlightedIndex - 1, 0);
            highlightItem(newIndex);
            items[newIndex]?.scrollIntoView({ block: 'nearest' });
        }
    } else if (e.key === 'Enter') {
        e.preventDefault();
        if (highlightedIndex >= 0 && items[highlightedIndex]) {
            selectTimezone(items[highlightedIndex].dataset.value);
            closeDropdown();
            timezoneInput.blur();
        }
    } else if (e.key === 'Escape') {
        closeDropdown();
        timezoneInput.blur();
    }
});

// Anchor time dropdown event listeners
anchorInput.addEventListener('click', function () {
    if (!anchorList.classList.contains('open')) {
        openAnchorDropdown();
    }
});

anchorInput.addEventListener('focus', function () {
    openAnchorDropdown();
});

anchorInput.addEventListener('blur', function () {
    setTimeout(closeAnchorDropdown, 150);
});

anchorInput.addEventListener('keydown', function (e) {
    const items = anchorList.querySelectorAll('.dropdown-item');

    if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (!anchorList.classList.contains('open')) {
            openAnchorDropdown();
        } else {
            const newIndex = Math.min(highlightedAnchorIndex + 1, items.length - 1);
            highlightAnchorItem(newIndex);
            items[newIndex]?.scrollIntoView({ block: 'nearest' });
        }
    } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (anchorList.classList.contains('open')) {
            const newIndex = Math.max(highlightedAnchorIndex - 1, 0);
            highlightAnchorItem(newIndex);
            items[newIndex]?.scrollIntoView({ block: 'nearest' });
        }
    } else if (e.key === 'Enter') {
        e.preventDefault();
        if (highlightedAnchorIndex >= 0 && items[highlightedAnchorIndex]) {
            selectAnchorTime(items[highlightedAnchorIndex].dataset.value);
            closeAnchorDropdown();
            anchorInput.blur();
        }
    } else if (e.key === 'Escape') {
        closeAnchorDropdown();
        anchorInput.blur();
    }
});

// Click outside closes dropdown
document.addEventListener('click', function (e) {
    const tzWrapper = document.getElementById('timezone_wrapper');
    const anchorWrapper = document.getElementById('anchor_wrapper');
    if (!tzWrapper.contains(e.target)) {
        closeDropdown();
    }
    if (!anchorWrapper.contains(e.target)) {
        closeAnchorDropdown();
    }
});


// Simulated time controls
editSimTimeBtn.addEventListener('click', function (e) {
    e.preventDefault();
    if (simEditor.style.display === 'none' || simEditor.style.display === '') {
        openSimEditor();
    } else {
        closeSimEditor();
    }
});

simOkBtn.addEventListener('click', function (e) {
    e.preventDefault();
    setSimulatedTimeFromInputs();
});

simCancelBtn.addEventListener('click', function (e) {
    e.preventDefault();
    closeSimEditor();
});

resetSimTimeBtn.addEventListener('click', function (e) {
    e.preventDefault();
    resetSimulatedTime();
});

// If timezone changes while simulated time is active, preserve edit mode and
// recompute the simulated instant under the new timezone (keeping wall-clock).
const _selectTimezoneOriginal = selectTimezone;
selectTimezone = function (tz) {
    // If we're in Edit mode, first recompute the simulated instant using the
    // *new* timezone while keeping the same wall-clock date/time.
    if (isSimulatedTimeActive && simulatedWallClock) {
        simulatedUtcDate = zonedTimeToUtc(
            simulatedWallClock.year,
            simulatedWallClock.month,
            simulatedWallClock.day,
            simulatedWallClock.hour,
            simulatedWallClock.minute,
            tz
        );
    }
    _selectTimezoneOriginal(tz);
    // Ensure reset visibility matches mode
    resetSimTimeBtn.style.display = isSimulatedTimeActive ? 'inline-block' : 'none';
};

// Initialize
populateAnchorTimes();
initTimezoneDropdown();
updateCalculation();
// Start the live ticker once on init (aligned to next second boundary).
startLiveTicker();