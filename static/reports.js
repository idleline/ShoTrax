let opsByDifficultyChart = null;
let avgByDifficultyChart = null;

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

function buildDifficultyChart(chartId, metricKey, label, color, difficulties) {
    const chartElement = document.getElementById(chartId);
    const dataset = difficulties.map(function (difficulty) {
        return {
            label: difficulty.label,
            value: Number(difficulty[metricKey]),
            atBats: difficulty.at_bats,
            displayValue: displayRate(difficulty[metricKey])
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

function renderDifficultyCharts(difficulties) {
    const hasData = difficulties.some(function (difficulty) {
        return difficulty.at_bats > 0;
    });

    destroyChart(opsByDifficultyChart);
    destroyChart(avgByDifficultyChart);
    opsByDifficultyChart = null;
    avgByDifficultyChart = null;

    toggleEmptyState("ops-chart", !hasData);
    toggleEmptyState("avg-chart", !hasData);

    if (!hasData || typeof Chart === "undefined") {
        return;
    }

    opsByDifficultyChart = buildDifficultyChart(
        "ops-by-difficulty-chart",
        "ops",
        "OPS",
        { background: "rgba(253, 126, 20, 0.72)", border: "#fd7e14" },
        difficulties
    );
    avgByDifficultyChart = buildDifficultyChart(
        "avg-by-difficulty-chart",
        "batting_average",
        "AVG",
        { background: "rgba(13, 110, 253, 0.72)", border: "#0d6efd" },
        difficulties
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
            return `
                <td>${difficulty.at_bats}</td>
                <td>${displayRate(difficulty.batting_average)}</td>
                <td>${displayRate(difficulty.ops)}</td>
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
            renderReportsTable(data);
        })
        .catch(function (error) {
            showReportsError(error.message || "Failed to load reports.");
        });
}

document.addEventListener("DOMContentLoaded", function () {
    loadReports();
});
