const programState = {
    programs: [],
    activeProgramId: null,
    activeProgram: null
};

function escapeHtml(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function showProgramAlert(message, isError = false) {
    const alert = document.querySelector("#programs-alert");
    alert.textContent = message;
    alert.className = `alert ${isError ? "alert-danger" : "alert-success"}`;
    window.setTimeout(() => alert.classList.add("d-none"), 4500);
}

async function apiRequest(url, options = {}) {
    const response = await fetch(url, {
        headers: {"Content-Type": "application/json", ...(options.headers || {})},
        ...options
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(payload.error || "Something went wrong.");
    }
    return payload;
}

function renderProgramList() {
    const list = document.querySelector("#program-list");
    list.innerHTML = programState.programs.map(program => `
        <button
            class="program-list-item ${program.earned_stars >= program.total_stars ? "complete" : ""} ${program.id === programState.activeProgramId ? "active" : ""}"
            type="button"
            data-program-id="${program.id}"
            role="listitem"
        >
            <span class="program-list-topline">
                <strong>${escapeHtml(program.name)}</strong>
                <span>${program.earned_stars}/${program.total_stars} ★</span>
            </span>
            <span class="program-list-progress" aria-hidden="true">
                <span style="width: ${program.progress_percent}%"></span>
            </span>
            <span class="program-list-meta">${program.completed_task_count} of ${program.task_count} tasks · ${escapeHtml(program.status)}</span>
        </button>
    `).join("");
}

function taskMarkup(task, category) {
    const rewardEarned = task.earned_stars > 0;
    const progressControl = category.shared_progress_enabled
        ? `
            <div class="shared-task-value" aria-label="${escapeHtml(task.title)} progress">
                ${task.current_value} <span>/ ${task.target_value}</span>
            </div>
        `
        : task.repeatable && task.completed
        ? `
            <div class="repeatable-complete-control">
                <span>${task.current_value} / ${task.target_value}</span>
                <button class="btn btn-sm btn-outline-secondary" type="button" data-reset-task-id="${task.id}">
                    Reset for next reward
                </button>
            </div>
        `
        : `
            <div class="task-stepper" data-task-id="${task.id}">
                <button class="task-step-button" type="button" data-action="decrement" aria-label="Decrease ${escapeHtml(task.title)}">−</button>
                <input
                    class="task-progress-input"
                    type="number"
                    min="0"
                    max="${task.target_value}"
                    value="${task.current_value}"
                    aria-label="${escapeHtml(task.title)} current value"
                >
                <span class="task-target">/ ${task.target_value}</span>
                <button class="task-step-button" type="button" data-action="increment" aria-label="Increase ${escapeHtml(task.title)}">+</button>
            </div>
        `;

    return `
        <article class="program-task ${task.completed ? "is-complete" : ""}">
            <div class="program-task-check" aria-hidden="true">${task.completed ? "✓" : ""}</div>
            <div class="program-task-content">
                <div class="d-flex flex-wrap align-items-start justify-content-between gap-2">
                    <div>
                        <h4 class="program-task-title">
                            ${escapeHtml(task.title)}
                            ${task.repeatable ? `<span class="repeatable-badge">Repeatable</span>` : ""}
                        </h4>
                        ${task.description ? `<p class="program-task-description">${escapeHtml(task.description).replaceAll("\n", "<br>")}</p>` : ""}
                        ${task.repeatable ? `
                            <p class="repeatable-awards mb-0">
                                ${task.repeat_completions} reward cycle${task.repeat_completions === 1 ? "" : "s"} earned · ${task.earned_stars} total stars
                            </p>
                        ` : ""}
                    </div>
                    <span class="star-reward ${rewardEarned ? "earned" : ""}">+${task.reward_stars} ★${task.repeatable ? " each" : ""}</span>
                </div>
                <div class="program-task-progress-row">
                    <div class="progress task-progress" role="progressbar" aria-label="${escapeHtml(task.title)} progress" aria-valuenow="${task.progress_percent}" aria-valuemin="0" aria-valuemax="100">
                        <div class="progress-bar" style="width: ${task.progress_percent}%"></div>
                    </div>
                    ${progressControl}
                </div>
            </div>
        </article>
    `;
}

function renderSummary(program) {
    const incompleteTasks = program.categories
        .flatMap(category => category.tasks)
        .filter(task => !task.completed)
        .sort((left, right) => {
            const leftRemaining = left.target_value - left.current_value;
            const rightRemaining = right.target_value - right.current_value;
            return leftRemaining - rightRemaining || right.reward_stars - left.reward_stars;
        })
        .slice(0, 3);

    document.querySelector("#program-summary").innerHTML = `
        <div class="program-summary-card">
            <div class="program-summary-header">
                <div>
                    <div class="d-flex flex-wrap align-items-center gap-2 mb-2">
                        <span class="program-status-badge">${escapeHtml(program.status)}</span>
                        <span class="text-muted small">${program.category_count} categories · ${program.task_count} tasks</span>
                    </div>
                    <h2>${escapeHtml(program.name)}</h2>
                    ${program.description ? `<p>${escapeHtml(program.description)}</p>` : ""}
                </div>
                <div class="program-star-total">
                    <span>${program.earned_stars}</span>
                    <small>of ${program.total_stars} stars</small>
                </div>
            </div>
            <div class="program-main-progress">
                <div class="d-flex justify-content-between mb-2">
                    <strong>${program.progress_percent}% complete</strong>
                    <span>${program.remaining_stars} stars remaining</span>
                </div>
                <div class="progress" role="progressbar" aria-label="Program progress" aria-valuenow="${program.progress_percent}" aria-valuemin="0" aria-valuemax="100">
                    <div class="progress-bar" style="width: ${program.progress_percent}%"></div>
                </div>
            </div>
            <div class="program-stat-grid">
                <div><span>${program.completed_task_count}</span><small>Tasks complete</small></div>
                <div><span>${program.task_count - program.completed_task_count}</span><small>Tasks remaining</small></div>
                <div><span>${program.available_stars}</span><small>Stars available</small></div>
                <div><span>${program.category_count}</span><small>Active categories</small></div>
            </div>
            ${incompleteTasks.length ? `
                <div class="program-next-up">
                    <span class="section-eyebrow">Closest to the finish line</span>
                    <div class="program-next-grid">
                        ${incompleteTasks.map(task => `
                            <div>
                                <strong>${escapeHtml(task.title)}</strong>
                                <span>${task.current_value}/${task.target_value} · +${task.reward_stars} ★</span>
                            </div>
                        `).join("")}
                    </div>
                </div>
            ` : `
                <div class="program-complete-callout">Every tracked objective is complete. Nice work.</div>
            `}
        </div>
    `;
}

function getOpenCategoryIds() {
    return new Set(
        Array.from(document.querySelectorAll(".program-category[open]"))
            .map(category => category.dataset.categoryId)
    );
}

function renderCategories(program, openCategoryIds = new Set()) {
    const container = document.querySelector("#program-categories");
    if (!program.categories.length) {
        container.innerHTML = `
            <div class="card shadow-sm">
                <div class="card-body text-center py-5">
                    <h3 class="h5">No categories yet</h3>
                    <p class="text-muted">Add tasks from the program workshop.</p>
                    <a class="btn btn-primary" href="/programs/manage">Manage program</a>
                </div>
            </div>
        `;
        return;
    }

    container.innerHTML = `
        <div class="d-flex align-items-end justify-content-between gap-3 mb-3">
            <div>
                <span class="section-eyebrow">Task board</span>
                <h2 class="h4 mb-0">Categories & objectives</h2>
            </div>
            <span class="small text-muted">Use the header counter or expand a category for task details</span>
        </div>
        <div class="program-category-list">
            ${program.categories.map(category => `
                <details
                    class="program-category"
                    data-category-id="${category.id}"
                    ${openCategoryIds.has(String(category.id)) ? "open" : ""}
                >
                    <summary>
                        <div>
                            <h3>${escapeHtml(category.name)}</h3>
                            <span>${category.completed_task_count} of ${category.task_count} complete · ${category.earned_stars}/${category.available_stars} ★</span>
                        </div>
                        ${category.shared_progress_enabled && category.tasks.length ? `
                            <div class="shared-category-header-control">
                                <div class="shared-category-header-label">
                                    <span class="section-eyebrow">Shared progress</span>
                                    <small>${category.shared_progress_value} / ${category.shared_progress_max}</small>
                                </div>
                                <div class="task-stepper" data-shared-category-id="${category.id}">
                                    <button class="task-step-button" type="button" data-category-action="decrement" aria-label="Decrease shared ${escapeHtml(category.name)} progress">−</button>
                                    <input
                                        class="category-progress-input"
                                        type="number"
                                        min="0"
                                        max="${category.shared_progress_max}"
                                        value="${category.shared_progress_value}"
                                        aria-label="Shared ${escapeHtml(category.name)} progress"
                                    >
                                    <span class="task-target">/ ${category.shared_progress_max}</span>
                                    <button class="task-step-button" type="button" data-category-action="increment" aria-label="Increase shared ${escapeHtml(category.name)} progress">+</button>
                                </div>
                            </div>
                        ` : `
                            <div class="category-summary-progress">
                                <span style="width: ${category.progress_percent}%"></span>
                            </div>
                        `}
                        <span class="category-chevron" aria-hidden="true">⌄</span>
                    </summary>
                    <div class="program-category-body">
                        ${category.description ? `<p class="category-description">${escapeHtml(category.description)}</p>` : ""}
                        ${category.tasks.length
                            ? category.tasks.map(task => taskMarkup(task, category)).join("")
                            : `<div class="text-muted py-3">No trackable tasks were found for this category. Add one from Manage Programs.</div>`
                        }
                    </div>
                </details>
            `).join("")}
        </div>
    `;
}

async function selectProgram(programId) {
    programState.activeProgramId = Number(programId);
    renderProgramList();
    try {
        const payload = await apiRequest(`/api/programs/${programState.activeProgramId}`);
        programState.activeProgram = payload.program;
        renderSummary(payload.program);
        renderCategories(payload.program);
        const url = new URL(window.location.href);
        url.searchParams.set("program", programState.activeProgramId);
        window.history.replaceState({}, "", url);
    } catch (error) {
        showProgramAlert(error.message, true);
    }
}

async function updateTaskProgress(taskId, currentValue) {
    const openCategoryIds = getOpenCategoryIds();
    try {
        const payload = await apiRequest(`/api/program-tasks/${taskId}/progress`, {
            method: "POST",
            body: JSON.stringify({current_value: currentValue})
        });
        programState.activeProgram = payload.program;
        const listProgram = programState.programs.find(program => program.id === payload.program.id);
        if (listProgram) {
            Object.assign(listProgram, payload.program);
        }
        renderProgramList();
        renderSummary(payload.program);
        renderCategories(payload.program, openCategoryIds);
    } catch (error) {
        showProgramAlert(error.message, true);
    }
}

async function updateCategoryProgress(categoryId, currentValue) {
    const openCategoryIds = getOpenCategoryIds();
    try {
        const payload = await apiRequest(`/api/program-categories/${categoryId}/progress`, {
            method: "POST",
            body: JSON.stringify({current_value: currentValue})
        });
        applyProgramUpdate(payload.program, openCategoryIds);
    } catch (error) {
        showProgramAlert(error.message, true);
    }
}

async function resetRepeatableTask(taskId) {
    const openCategoryIds = getOpenCategoryIds();
    try {
        const payload = await apiRequest(`/api/program-tasks/${taskId}/reset`, {
            method: "POST",
            body: JSON.stringify({})
        });
        applyProgramUpdate(payload.program, openCategoryIds);
        showProgramAlert(payload.message);
    } catch (error) {
        showProgramAlert(error.message, true);
    }
}

function applyProgramUpdate(program, openCategoryIds) {
    programState.activeProgram = program;
    const listProgram = programState.programs.find(candidate => candidate.id === program.id);
    if (listProgram) {
        Object.assign(listProgram, program);
    }
    renderProgramList();
    renderSummary(program);
    renderCategories(program, openCategoryIds);
}

async function initializePrograms() {
    try {
        const payload = await apiRequest("/api/programs");
        programState.programs = payload.programs;
        if (!payload.programs.length) {
            document.querySelector("#program-empty").classList.remove("d-none");
            return;
        }

        document.querySelector("#program-dashboard").classList.remove("d-none");
        const requestedId = Number(new URLSearchParams(window.location.search).get("program"));
        const initialProgram = payload.programs.find(program => program.id === requestedId) || payload.programs[0];
        await selectProgram(initialProgram.id);
    } catch (error) {
        showProgramAlert(error.message, true);
    }
}

document.querySelector("#program-list").addEventListener("click", event => {
    const item = event.target.closest("[data-program-id]");
    if (item) {
        selectProgram(item.dataset.programId);
    }
});

document.querySelector("#program-categories").addEventListener("click", event => {
    const sharedHeaderControl = event.target.closest(".shared-category-header-control");
    if (sharedHeaderControl) {
        // The controls live inside <summary>; keep the category collapsed while using them.
        event.preventDefault();
    }

    const categoryButton = event.target.closest("[data-category-action]");
    if (categoryButton) {
        const stepper = categoryButton.closest("[data-shared-category-id]");
        const input = stepper.querySelector("input");
        const delta = categoryButton.dataset.categoryAction === "increment" ? 1 : -1;
        const nextValue = Math.max(0, Math.min(Number(input.max), Number(input.value) + delta));
        updateCategoryProgress(stepper.dataset.sharedCategoryId, nextValue);
        return;
    }

    const resetButton = event.target.closest("[data-reset-task-id]");
    if (resetButton) {
        resetRepeatableTask(resetButton.dataset.resetTaskId);
        return;
    }

    const button = event.target.closest("[data-action]");
    if (!button) {
        return;
    }
    const stepper = button.closest("[data-task-id]");
    const input = stepper.querySelector("input");
    const delta = button.dataset.action === "increment" ? 1 : -1;
    const nextValue = Math.max(0, Math.min(Number(input.max), Number(input.value) + delta));
    updateTaskProgress(stepper.dataset.taskId, nextValue);
});

document.querySelector("#program-categories").addEventListener("change", event => {
    const categoryInput = event.target.closest(".category-progress-input");
    if (categoryInput) {
        const stepper = categoryInput.closest("[data-shared-category-id]");
        updateCategoryProgress(stepper.dataset.sharedCategoryId, Number(categoryInput.value));
        return;
    }

    const input = event.target.closest(".task-progress-input");
    if (!input) {
        return;
    }
    const stepper = input.closest("[data-task-id]");
    updateTaskProgress(stepper.dataset.taskId, Number(input.value));
});

initializePrograms();
