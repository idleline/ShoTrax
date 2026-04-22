let opsByDifficultyChart = null;
let avgByDifficultyChart = null;
let opsByModeChart = null;
let avgByModeChart = null;

function displayRate(value) {
    const fixed = Number(value).toFixed(3);
    return fixed.startsWith("0.") ? `.${fixed.split(".")[1]}` : fixed;
}

function showReportsError(message) {
    const errorElement = document.getElementById("reports-error");
    errorElement.textContent = message;
    errorElement.classList.remove("d-none");
}

function hideReportsError() {
    document.getElementById("reports-error").classList.add("d-none");
}

function toggleEmptyState(prefix, isEmpty) {
    document.getElementById(`${prefix}-empty`).classList.toggle("d-none", !isEmpty);
    document.getElementById(`${prefix}-container`).classList.toggle("d-none", isEmpty);
}

function destroyChart(chartInstance) {
    if (chartInstance) {
        chartInstance.destroy();
    }
}

function buildBarChart(chartId, metricKey, label, color, records) {
    const chartElement = document.getElementById(chartId);
    const dataset = records.map(function (record) {
        return {
            label: record.label,
            value: Number(record[metricKey]),
            atBats: record.at_bats,
            displayValue: displayRate(record[metricKey])
        };
    });

    return new Chart(chartElement, {
        type: "bar",
        data: {
            labels: dataset.map(function (item) {
                return item.label;
            }),
            datasets: [
                {
                    label: label,
                    data: dataset.map(function (item) {
                        return {
                            x: item.label,
                            y: item.value,
                            atBats: item.atBats,
                            displayValue: item.displayValue
                        };
                    }),
                    backgroundColor: color.background,
                    borderColor: color.border,
                    borderWidth: 2,
                    borderRadius: 8,
                    maxBarThickness: 56
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    callbacks: {
                        title: function (items) {
                            return items[0].label;
                        },
                        label: function (context) {
                            return `${label}: ${context.raw.displayValue}`;
                        },
                        afterLabel: function (context) {
                            return `ABs: ${context.raw.atBats}`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    grid: {
                        display: false
                    }
                },
                y: {
                    beginAtZero: true,
                    ticks: {
                        callback: function (value) {
                            return displayRate(value);
                        }
                    }
                }
            }
        }
    });
}

function renderBarChart(chartKey, emptyPrefix, chartId, metricKey, label, color, records) {
    const hasData = records.some(function (record) {
        return record.at_bats > 0;
    });

    if (chartKey === "opsByDifficulty") {
        destroyChart(opsByDifficultyChart);
        opsByDifficultyChart = null;
    } else if (chartKey === "avgByDifficulty") {
        destroyChart(avgByDifficultyChart);
        avgByDifficultyChart = null;
    } else if (chartKey === "opsByMode") {
        destroyChart(opsByModeChart);
        opsByModeChart = null;
    } else if (chartKey === "avgByMode") {
        destroyChart(avgByModeChart);
        avgByModeChart = null;
    }

    toggleEmptyState(emptyPrefix, !hasData);

    if (!hasData || typeof Chart === "undefined") {
        return;
    }

    const chartInstance = buildBarChart(chartId, metricKey, label, color, records);

    if (chartKey === "opsByDifficulty") {
        opsByDifficultyChart = chartInstance;
    } else if (chartKey === "avgByDifficulty") {
        avgByDifficultyChart = chartInstance;
    } else if (chartKey === "opsByMode") {
        opsByModeChart = chartInstance;
    } else if (chartKey === "avgByMode") {
        avgByModeChart = chartInstance;
    }
}

function renderDifficultyCharts(difficulties) {
    renderBarChart(
        "opsByDifficulty",
        "ops-chart",
        "ops-by-difficulty-chart",
        "ops",
        "OPS",
        { background: "rgba(241, 90, 41, 0.72)", border: "#F15A29" },
        difficulties
    );
    renderBarChart(
        "avgByDifficulty",
        "avg-chart",
        "avg-by-difficulty-chart",
        "batting_average",
        "AVG",
        { background: "rgba(13, 110, 253, 0.72)", border: "#0d6efd" },
        difficulties
    );
}

function buildModeSummaries(gameModes) {
    return gameModes.map(function (gameMode) {
        const totals = gameMode.difficulties.reduce(function (summary, difficulty) {
            return {
                atBats: summary.atBats + difficulty.at_bats,
                hits: summary.hits + Number(difficulty.hits || 0),
                totalBases: summary.totalBases + Number(difficulty.total_bases || 0)
            };
        }, { atBats: 0, hits: 0, totalBases: 0 });
        const battingAverage = totals.atBats ? totals.hits / totals.atBats : 0;
        const sluggingPercentage = totals.atBats ? totals.totalBases / totals.atBats : 0;

        return {
            key: gameMode.key,
            label: gameMode.label,
            at_bats: totals.atBats,
            batting_average: battingAverage.toFixed(3),
            ops: (battingAverage + sluggingPercentage).toFixed(3)
        };
    });
}

function renderModeCharts(gameModes) {
    const modeSummaries = buildModeSummaries(gameModes);

    renderBarChart(
        "opsByMode",
        "ops-mode-chart",
        "ops-by-mode-chart",
        "ops",
        "OPS",
        { background: "rgba(241, 90, 41, 0.72)", border: "#F15A29" },
        modeSummaries
    );
    renderBarChart(
        "avgByMode",
        "avg-mode-chart",
        "avg-by-mode-chart",
        "batting_average",
        "AVG",
        { background: "rgba(13, 110, 253, 0.72)", border: "#0d6efd" },
        modeSummaries
    );
}

function renderReportsTable(data) {
    const groupHeader = document.getElementById("reports-header-groups");
    const columnHeader = document.getElementById("reports-header-columns");
    const tableBody = document.getElementById("reports-table-body");
    const hasData = data.game_modes.some(function (gameMode) {
        return gameMode.difficulties.some(function (difficulty) {
            return difficulty.at_bats > 0;
        });
    });

    groupHeader.innerHTML = "<th rowspan=\"2\">Game Mode</th>";
    columnHeader.innerHTML = "";
    tableBody.innerHTML = "";

    data.difficulties.forEach(function (difficulty) {
        groupHeader.insertAdjacentHTML(
            "beforeend",
            `<th colspan="3" class="text-center">${difficulty.label}</th>`
        );
        columnHeader.insertAdjacentHTML(
            "beforeend",
            "<th>ABs</th><th>AVG</th><th>OPS</th>"
        );
    });

    document.getElementById("reports-table-empty").classList.toggle("d-none", hasData);
    document.getElementById("reports-table-container").classList.toggle("d-none", !hasData);

    if (!hasData) {
        return;
    }

    data.game_modes.forEach(function (gameMode) {
        const cells = gameMode.difficulties.map(function (difficulty) {
            const battingAverage = difficulty.at_bats > 0
                ? displayRate(difficulty.batting_average)
                : "";
            const ops = difficulty.at_bats > 0
                ? displayRate(difficulty.ops)
                : "";

            return `
                <td>${difficulty.at_bats}</td>
                <td>${battingAverage}</td>
                <td>${ops}</td>
            `;
        }).join("");

        tableBody.insertAdjacentHTML(
            "beforeend",
            `<tr><th scope="row">${gameMode.label}</th>${cells}</tr>`
        );
    });
}

function loadReports() {
    fetch("/api/reports")
        .then(function (response) {
            if (!response.ok) {
                throw new Error("Failed to load reports.");
            }
            return response.json();
        })
        .then(function (data) {
            hideReportsError();
            renderDifficultyCharts(data.difficulties || []);
            renderModeCharts(data.game_modes || []);
            renderReportsTable(data);
        })
        .catch(function (error) {
            showReportsError(error.message || "Failed to load reports.");
        });
}

document.addEventListener("DOMContentLoaded", function () {
    loadReports();
});
