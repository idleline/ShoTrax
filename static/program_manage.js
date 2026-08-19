const manageState = {
    programs: [],
    activeProgram: null,
    taskModal: null
};

function escapeHtml(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function showManageAlert(message, isError = false) {
    const alert = document.querySelector("#manage-alert");
    alert.textContent = message;
    alert.className = `alert ${isError ? "alert-danger" : "alert-success"}`;
    alert.scrollIntoView({behavior: "smooth", block: "nearest"});
    window.setTimeout(() => alert.classList.add("d-none"), 5000);
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

function formValue(form, name) {
    return new FormData(form).get(name);
}

function switchToManage(programId) {
    document.querySelector("#manage-tab").click();
    loadPrograms(programId);
}

document.querySelector("#create-program-form").addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.currentTarget;
    try {
        const payload = await apiRequest("/api/programs", {
            method: "POST",
            body: JSON.stringify({
                name: formValue(form, "name"),
                total_stars: formValue(form, "total_stars"),
                description: formValue(form, "description"),
                initial_task: {
                    category: formValue(form, "category"),
                    title: formValue(form, "task_title"),
                    description: formValue(form, "task_description"),
                    target_value: formValue(form, "target_value"),
                    reward_stars: formValue(form, "reward_stars"),
                    repeatable: formValue(form, "repeatable") === "on"
                }
            })
        });
        form.reset();
        document.querySelector("#create-task-value").value = 1;
        document.querySelector("#create-task-reward").value = 3;
        showManageAlert(payload.message);
        switchToManage(payload.program.id);
    } catch (error) {
        showManageAlert(error.message, true);
    }
});

function importPayload(form) {
    return {
        name: formValue(form, "name"),
        total_stars: formValue(form, "total_stars"),
        description: formValue(form, "description"),
        html: formValue(form, "html")
    };
}

document.querySelector("#preview-import").addEventListener("click", async () => {
    const form = document.querySelector("#import-program-form");
    const preview = document.querySelector("#import-preview");
    try {
        const payload = await apiRequest("/api/programs/import-preview", {
            method: "POST",
            body: JSON.stringify({html: formValue(form, "html")})
        });
        preview.classList.remove("d-none");
        preview.innerHTML = `
            <strong>${payload.task_count} tasks found</strong>
            <span>across ${payload.category_count} categories</span>
            <div>${payload.categories.map(category => `
                <span>${escapeHtml(category.name)} · ${category.tasks.length}</span>
            `).join("")}</div>
        `;
    } catch (error) {
        preview.classList.add("d-none");
        showManageAlert(error.message, true);
    }
});

document.querySelector("#import-program-form").addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.currentTarget;
    try {
        const payload = await apiRequest("/api/programs/import", {
            method: "POST",
            body: JSON.stringify(importPayload(form))
        });
        form.reset();
        document.querySelector("#import-preview").classList.add("d-none");
        showManageAlert(payload.message);
        switchToManage(payload.program.id);
    } catch (error) {
        showManageAlert(error.message, true);
    }
});

function allTasks(program) {
    return program.categories.flatMap(category => category.tasks);
}

function renderTaskList() {
    const container = document.querySelector("#manage-task-list");
    const tasks = allTasks(manageState.activeProgram);
    if (!tasks.length) {
        container.innerHTML = `<p class="text-muted">This program has no tasks yet.</p>`;
        return;
    }

    container.innerHTML = manageState.activeProgram.categories.map(category => `
        <div class="manage-category-group">
            <div class="manage-category-heading">
                <strong>${escapeHtml(category.name)}</strong>
                <div class="manage-category-settings">
                    <span>${category.tasks.length} task${category.tasks.length === 1 ? "" : "s"}</span>
                    <label class="form-check form-switch mb-0" title="${category.has_repeatable_tasks ? "Shared progress is unavailable for categories with repeatable tasks." : "Use one counter for all task thresholds."}">
                        <input
                            class="form-check-input"
                            type="checkbox"
                            data-shared-category-toggle="${category.id}"
                            ${category.shared_progress_enabled ? "checked" : ""}
                            ${category.has_repeatable_tasks ? "disabled" : ""}
                        >
                        <span class="form-check-label">Shared counter</span>
                    </label>
                </div>
            </div>
            ${category.tasks.map(task => `
                <button class="manage-task-row" type="button" data-edit-task="${task.id}">
                    <span>
                        <strong>${escapeHtml(task.title)}</strong>
                        <small>
                            ${task.current_value}/${task.target_value} · ${task.reward_stars} stars
                            ${task.repeatable ? ` · Repeatable (${task.repeat_completions} earned)` : ""}
                        </small>
                    </span>
                    <span class="manage-edit-label">Edit</span>
                </button>
            `).join("")}
        </div>
    `).join("");
}

function renderActiveProgram() {
    const program = manageState.activeProgram;
    document.querySelector("#edit-name").value = program.name;
    document.querySelector("#edit-total-stars").value = program.total_stars;
    document.querySelector("#edit-description").value = program.description;
    document.querySelector("#manage-program-stats").textContent =
        `${program.earned_stars}/${program.total_stars} stars · ${program.completed_task_count}/${program.task_count} tasks complete`;

    document.querySelector("#program-category-options").innerHTML = program.categories
        .map(category => `<option value="${escapeHtml(category.name)}"></option>`)
        .join("");
    renderTaskList();
}

async function selectManageProgram(programId) {
    try {
        const payload = await apiRequest(`/api/programs/${programId}`);
        manageState.activeProgram = payload.program;
        document.querySelector("#manage-program-select").value = String(payload.program.id);
        renderActiveProgram();
    } catch (error) {
        showManageAlert(error.message, true);
    }
}

async function loadPrograms(preferredId = null) {
    try {
        const payload = await apiRequest("/api/programs");
        manageState.programs = payload.programs;
        const empty = document.querySelector("#manage-empty");
        const workspace = document.querySelector("#manage-workspace");
        if (!payload.programs.length) {
            empty.classList.remove("d-none");
            workspace.classList.add("d-none");
            return;
        }

        empty.classList.add("d-none");
        workspace.classList.remove("d-none");
        const select = document.querySelector("#manage-program-select");
        select.innerHTML = payload.programs.map(program =>
            `<option value="${program.id}">${escapeHtml(program.name)}</option>`
        ).join("");
        const requestedId = Number(preferredId || new URLSearchParams(window.location.search).get("program"));
        const active = payload.programs.find(program => program.id === requestedId) || payload.programs[0];
        await selectManageProgram(active.id);
    } catch (error) {
        showManageAlert(error.message, true);
    }
}

document.querySelector("#manage-program-select").addEventListener("change", event => {
    selectManageProgram(event.target.value);
});

document.querySelector("#edit-program-form").addEventListener("submit", async event => {
    event.preventDefault();
    try {
        const payload = await apiRequest(`/api/programs/${manageState.activeProgram.id}`, {
            method: "PATCH",
            body: JSON.stringify({
                name: document.querySelector("#edit-name").value,
                total_stars: document.querySelector("#edit-total-stars").value,
                description: document.querySelector("#edit-description").value
            })
        });
        manageState.activeProgram = payload.program;
        showManageAlert(payload.message);
        await loadPrograms(payload.program.id);
    } catch (error) {
        showManageAlert(error.message, true);
    }
});

document.querySelector("#delete-program").addEventListener("click", async () => {
    const program = manageState.activeProgram;
    if (!window.confirm(`Delete “${program.name}” and all of its tasks?`)) {
        return;
    }
    try {
        const payload = await apiRequest(`/api/programs/${program.id}`, {method: "DELETE"});
        manageState.activeProgram = null;
        showManageAlert(payload.message);
        await loadPrograms();
    } catch (error) {
        showManageAlert(error.message, true);
    }
});

document.querySelector("#add-task-form").addEventListener("submit", async event => {
    event.preventDefault();
    try {
        const payload = await apiRequest(`/api/programs/${manageState.activeProgram.id}/tasks`, {
            method: "POST",
            body: JSON.stringify({
                category: document.querySelector("#task-category").value,
                title: document.querySelector("#task-title").value,
                description: document.querySelector("#task-description").value,
                target_value: document.querySelector("#task-value").value,
                reward_stars: document.querySelector("#task-reward").value,
                repeatable: document.querySelector("#task-repeatable").checked
            })
        });
        manageState.activeProgram = payload.program;
        event.currentTarget.reset();
        document.querySelector("#task-value").value = 1;
        document.querySelector("#task-reward").value = 3;
        renderActiveProgram();
        showManageAlert(payload.message);
    } catch (error) {
        showManageAlert(error.message, true);
    }
});

document.querySelector("#manage-task-list").addEventListener("change", async event => {
    const toggle = event.target.closest("[data-shared-category-toggle]");
    if (!toggle) {
        return;
    }
    try {
        const payload = await apiRequest(`/api/program-categories/${toggle.dataset.sharedCategoryToggle}`, {
            method: "PATCH",
            body: JSON.stringify({shared_progress_enabled: toggle.checked})
        });
        manageState.activeProgram = payload.program;
        renderActiveProgram();
        showManageAlert(payload.message);
    } catch (error) {
        toggle.checked = !toggle.checked;
        showManageAlert(error.message, true);
    }
});

document.querySelector("#manage-task-list").addEventListener("click", event => {
    const row = event.target.closest("[data-edit-task]");
    if (!row) {
        return;
    }
    const task = allTasks(manageState.activeProgram).find(candidate => candidate.id === Number(row.dataset.editTask));
    document.querySelector("#modal-task-id").value = task.id;
    document.querySelector("#modal-task-category").value = task.category;
    document.querySelector("#modal-task-title").value = task.title;
    document.querySelector("#modal-task-description").value = task.description;
    document.querySelector("#modal-task-current").value = task.current_value;
    document.querySelector("#modal-task-target").value = task.target_value;
    document.querySelector("#modal-task-reward").value = task.reward_stars;
    document.querySelector("#modal-task-repeatable").checked = task.repeatable;
    document.querySelector("#modal-repeatable-status").textContent = task.repeatable
        ? `${task.repeat_completions} reward cycle${task.repeat_completions === 1 ? "" : "s"} earned (${task.earned_stars} stars retained).`
        : "Each completed cycle awards the configured stars.";
    manageState.taskModal.show();
});

document.querySelector("#edit-task-form").addEventListener("submit", async event => {
    event.preventDefault();
    const taskId = document.querySelector("#modal-task-id").value;
    try {
        const payload = await apiRequest(`/api/program-tasks/${taskId}`, {
            method: "PATCH",
            body: JSON.stringify({
                category: document.querySelector("#modal-task-category").value,
                title: document.querySelector("#modal-task-title").value,
                description: document.querySelector("#modal-task-description").value,
                current_value: document.querySelector("#modal-task-current").value,
                target_value: document.querySelector("#modal-task-target").value,
                reward_stars: document.querySelector("#modal-task-reward").value,
                repeatable: document.querySelector("#modal-task-repeatable").checked
            })
        });
        manageState.activeProgram = payload.program;
        renderActiveProgram();
        manageState.taskModal.hide();
        showManageAlert(payload.message);
    } catch (error) {
        showManageAlert(error.message, true);
    }
});

document.querySelector("#delete-task").addEventListener("click", async () => {
    const taskId = document.querySelector("#modal-task-id").value;
    const task = allTasks(manageState.activeProgram).find(candidate => candidate.id === Number(taskId));
    if (!window.confirm(`Remove “${task.title}” from this program?`)) {
        return;
    }
    try {
        const payload = await apiRequest(`/api/program-tasks/${taskId}`, {method: "DELETE"});
        manageState.activeProgram = payload.program;
        renderActiveProgram();
        manageState.taskModal.hide();
        showManageAlert(payload.message);
    } catch (error) {
        showManageAlert(error.message, true);
    }
});

manageState.taskModal = new bootstrap.Modal(document.querySelector("#edit-task-modal"));
loadPrograms();
