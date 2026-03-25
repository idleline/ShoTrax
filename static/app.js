let performanceChart = null;
let allEventsCache = [];

function normalizeUtcTimestamp(isoString) {
    if (typeof isoString !== "string") {
        return isoString;
    }

    return /(?:Z|[+-]\d{2}:\d{2})$/.test(isoString)
        ? isoString
        : `${isoString}Z`;
}

function getOrdinal(day) {
    if (day >= 11 && day <= 13) {
        return "th";
    }

    switch (day % 10) {
        case 1:
            return "st";
        case 2:
            return "nd";
        case 3:
            return "rd";
        default:
            return "th";
    }
}

function formatTimestamp(isoString) {
    const date = new Date(normalizeUtcTimestamp(isoString));

    if (isNaN(date)) {
        return isoString; // fallback if parsing fails
    }

    const time = date.toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
        hour12: true
    }).toLowerCase();

    const month = date.toLocaleDateString("en-US", {
        month: "long"
    });

    const day = date.getDate();
    const year = date.getFullYear();

    return `${time} on ${month} ${day}${getOrdinal(day)}, ${year}`;
}

function formatOutcome(outcome) {
    return outcome
        .replaceAll("_", " ")
        .replace(/\b\w/g, function (char) {
            return char.toUpperCase();
        });
}

function displayRate(value) {
    if (typeof value !== "string") {
        return ".000";
    }
    return value.startsWith("0.") ? "." + value.split(".")[1] : value;
}

function formatRateNumber(value) {
    const fixed = Number(value).toFixed(3);
    return fixed.startsWith("0.") ? `.${fixed.split(".")[1]}` : fixed;
}

function showMessage(message, isError = false) {
    const cssClass = isError ? "text-danger" : "text-success";
    $("#status-message")
        .removeClass("text-danger text-success")
        .addClass(cssClass)
        .text(message);
}

function updateStats(stats) {
    $("#stat-at-bats").text(stats.at_bats);
    $("#stat-hits").text(stats.hits);
    $("#stat-avg").text(displayRate(stats.batting_average));
    $("#stat-obp").text(displayRate(stats.on_base_percentage));
    $("#stat-slg").text(displayRate(stats.slugging_percentage));
    $("#stat-ops").text(stats.ops);
    $("#stat-singles").text(stats.singles);
    $("#stat-doubles").text(stats.doubles);
    $("#stat-triples").text(stats.triples);
    $("#stat-home-runs").text(stats.home_runs);
    $("#stat-outs").text(stats.outs);
    $("#stat-total-bases").text(stats.total_bases);
    $("#stat-sample-size").text(stats.sample_size);
}

function renderEvents(events) {
    const tbody = $("#events-table-body");
    tbody.empty();

    if (!events || events.length === 0) {
        tbody.append(`
            <tr>
                <td colspan="3" class="text-center text-muted">No events yet</td>
            </tr>
        `);
        return;
    }

    events.forEach(function (event) {
        tbody.append(`
            <tr>
                <td>${event.id}</td>
                <td>${formatOutcome(event.outcome)}</td>
                <td>${formatTimestamp(event.created_at)}</td>
            </tr>
        `);
    });
}

function getLocalDayKey(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

function getStartOfLocalDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date, days) {
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    return result;
}

function createLocalDateFromKey(dayKey) {
    const parts = dayKey.split("-").map(Number);
    return new Date(parts[0], parts[1] - 1, parts[2]);
}

function compareEventsByTime(a, b) {
    const firstDate = new Date(normalizeUtcTimestamp(a.created_at));
    const secondDate = new Date(normalizeUtcTimestamp(b.created_at));
    const firstTime = firstDate.getTime();
    const secondTime = secondDate.getTime();

    if (firstTime !== secondTime) {
        return firstTime - secondTime;
    }

    return (a.id || 0) - (b.id || 0);
}

function applyOutcomeToTotals(totals, outcome) {
    totals.atBats += 1;

    switch (outcome) {
        case "single":
            totals.hits += 1;
            totals.totalBases += 1;
            break;
        case "double":
            totals.hits += 1;
            totals.totalBases += 2;
            break;
        case "triple":
            totals.hits += 1;
            totals.totalBases += 3;
            break;
        case "home_run":
            totals.hits += 1;
            totals.totalBases += 4;
            break;
        default:
            break;
    }
}

function calculateRunningRates(totals) {
    const battingAverage = totals.atBats ? totals.hits / totals.atBats : 0;
    const sluggingPercentage = totals.atBats ? totals.totalBases / totals.atBats : 0;

    return {
        avg: battingAverage,
        ops: battingAverage + sluggingPercentage
    };
}

function buildDailyRunningSeries(events) {
    if (!Array.isArray(events) || events.length === 0) {
        return [];
    }

    const sortedEvents = events.slice().sort(compareEventsByTime);
    const dailySnapshots = new Map();
    const totals = {
        atBats: 0,
        hits: 0,
        totalBases: 0
    };

    sortedEvents.forEach(function (event) {
        const date = new Date(normalizeUtcTimestamp(event.created_at));

        if (isNaN(date)) {
            return;
        }

        applyOutcomeToTotals(totals, event.outcome);
        dailySnapshots.set(getLocalDayKey(date), calculateRunningRates(totals));
    });

    if (dailySnapshots.size === 0) {
        return [];
    }

    const dayKeys = Array.from(dailySnapshots.keys());
    const firstDay = createLocalDateFromKey(dayKeys[0]);
    const lastDay = createLocalDateFromKey(dayKeys[dayKeys.length - 1]);
    const points = [];
    let latestSnapshot = null;

    for (let cursor = new Date(firstDay); cursor <= lastDay; cursor = addDays(cursor, 1)) {
        const dayKey = getLocalDayKey(cursor);

        if (dailySnapshots.has(dayKey)) {
            latestSnapshot = dailySnapshots.get(dayKey);
        }

        if (latestSnapshot) {
            points.push({
                x: getStartOfLocalDay(cursor),
                avg: latestSnapshot.avg,
                ops: latestSnapshot.ops
            });
        }
    }

    return points;
}

function filterSeriesByWindow(points, windowValue) {
    if (windowValue === "all" || points.length === 0) {
        return points;
    }

    const windowDays = Number(windowValue);
    if (!windowDays) {
        return points;
    }

    const latestDay = points[points.length - 1].x;
    const cutoff = getStartOfLocalDay(addDays(latestDay, -(windowDays - 1)));

    return points.filter(function (point) {
        return point.x >= cutoff;
    });
}

function determineChartUnit(points) {
    if (points.length <= 1) {
        return "day";
    }

    const millisecondsPerDay = 24 * 60 * 60 * 1000;
    const spanInDays = Math.round((points[points.length - 1].x - points[0].x) / millisecondsPerDay);

    if (spanInDays > 180) {
        return "month";
    }

    if (spanInDays > 60) {
        return "week";
    }

    return "day";
}

function renderPerformanceChart(events) {
    const emptyState = $("#performance-chart-empty");
    const chartContainer = $("#performance-chart-container");

    if (performanceChart) {
        performanceChart.destroy();
        performanceChart = null;
    }

    if (typeof Chart === "undefined") {
        emptyState.text("Chart library failed to load.");
        emptyState.show();
        chartContainer.hide();
        return;
    }

    const series = filterSeriesByWindow(buildDailyRunningSeries(events), $("#chart-window").val());

    if (series.length === 0) {
        emptyState.text("Add events to see the daily running AVG and OPS trend.");
        emptyState.show();
        chartContainer.hide();
        return;
    }

    emptyState.hide();
    chartContainer.show();

    const maxRate = series.reduce(function (maxValue, point) {
        return Math.max(maxValue, point.avg, point.ops);
    }, 0);
    const chartElement = document.getElementById("performance-chart");

    performanceChart = new Chart(chartElement, {
        type: "line",
        data: {
            datasets: [
                {
                    label: "AVG",
                    data: series.map(function (point) {
                        return { x: point.x, y: point.avg };
                    }),
                    borderColor: "#0d6efd",
                    backgroundColor: "rgba(13, 110, 253, 0.12)",
                    borderWidth: 3,
                    tension: 0.25,
                    pointRadius: 0,
                    pointHoverRadius: 4
                },
                {
                    label: "OPS",
                    data: series.map(function (point) {
                        return { x: point.x, y: point.ops };
                    }),
                    borderColor: "#fd7e14",
                    backgroundColor: "rgba(253, 126, 20, 0.12)",
                    borderWidth: 3,
                    tension: 0.25,
                    pointRadius: 0,
                    pointHoverRadius: 4
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: "index",
                intersect: false
            },
            plugins: {
                legend: {
                    position: "top"
                },
                tooltip: {
                    callbacks: {
                        label: function (context) {
                            return `${context.dataset.label}: ${formatRateNumber(context.parsed.y)}`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    type: "time",
                    time: {
                        unit: determineChartUnit(series),
                        tooltipFormat: "MMM d, yyyy"
                    },
                    title: {
                        display: true,
                        text: "Day"
                    },
                    grid: {
                        display: false
                    }
                },
                y: {
                    beginAtZero: true,
                    suggestedMax: Math.max(1.1, maxRate * 1.1),
                    title: {
                        display: true,
                        text: "Rate"
                    },
                    ticks: {
                        callback: function (value) {
                            return formatRateNumber(value);
                        }
                    }
                }
            }
        }
    });
}

function loadStats() {
    const statsLimit = $("#stats-limit").val();

    $.ajax({
        url: "/api/stats",
        method: "GET",
        data: { limit: statsLimit },
        success: function (response) {
            updateStats(response);
        },
        error: function () {
            showMessage("Failed to load stats.", true);
        }
    });
}

function loadEvents() {
    const historyLimit = $("#history-limit").val();

    $.ajax({
        url: "/api/events",
        method: "GET",
        data: { limit: historyLimit },
        success: function (response) {
            renderEvents(response.events);
        },
        error: function () {
            showMessage("Failed to load events.", true);
        }
    });
}

function loadPerformanceChart() {
    $.ajax({
        url: "/api/events",
        method: "GET",
        data: { limit: "all" },
        success: function (response) {
            allEventsCache = Array.isArray(response.events) ? response.events : [];
            renderPerformanceChart(allEventsCache);
        },
        error: function () {
            showMessage("Failed to load performance chart.", true);
        }
    });
}

function submitEvent() {
    const outcome = $("#outcome").val();
    const statsLimit = $("#stats-limit").val();
    const historyLimit = $("#history-limit").val();

    $.ajax({
        url: `/api/events?stats_limit=${encodeURIComponent(statsLimit)}&history_limit=${encodeURIComponent(historyLimit)}`,
        method: "POST",
        contentType: "application/json",
        data: JSON.stringify({ outcome: outcome }),
        dataType: "json",
        success: function (response) {
            updateStats(response.stats);
            renderEvents(response.events);
            loadPerformanceChart();
            showMessage(response.message || "Event recorded.");
        },
        error: function (xhr) {
            const message = xhr.responseJSON?.error || "Failed to record event.";
            showMessage(message, true);
        }
    });
}

function deleteLastEvent() {
    const statsLimit = $("#stats-limit").val();
    const historyLimit = $("#history-limit").val();

    $.ajax({
        url: `/api/events/last?stats_limit=${encodeURIComponent(statsLimit)}&history_limit=${encodeURIComponent(historyLimit)}`,
        method: "DELETE",
        success: function (response) {
            updateStats(response.stats);
            renderEvents(response.events);
            loadPerformanceChart();
            showMessage(response.message || "Last event deleted.");
        },
        error: function (xhr) {
            const message = xhr.responseJSON?.error || "Failed to delete last event.";
            showMessage(message, true);
        }
    });
}

function deleteAllEvents() {
    const statsLimit = $("#stats-limit").val();
    const historyLimit = $("#history-limit").val();

    $.ajax({
        url: `/api/events?stats_limit=${encodeURIComponent(statsLimit)}&history_limit=${encodeURIComponent(historyLimit)}`,
        method: "DELETE",
        success: function (response) {
            updateStats(response.stats);
            renderEvents(response.events);
            loadPerformanceChart();
            showMessage(response.message || "All events deleted.");
        },
        error: function (xhr) {
            const message = xhr.responseJSON?.error || "Failed to delete all events.";
            showMessage(message, true);
        }
    });
}

$(document).ready(function () {
    loadStats();
    loadEvents();
    loadPerformanceChart();

    $("#submit-event").on("click", function () {
        submitEvent();
    });

    $("#delete-last-event").on("click", function () {
        deleteLastEvent();
    });

    $("#delete-all-events").on("click", function () {
        const confirmed = window.confirm("Delete all recorded events?");
        if (confirmed) {
            deleteAllEvents();
        }
    });

    $("#stats-limit").on("change", function () {
        loadStats();
    });

    $("#history-limit").on("change", function () {
        loadEvents();
    });

    $("#chart-window").on("change", function () {
        renderPerformanceChart(allEventsCache);
    });
});
