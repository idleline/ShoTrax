from __future__ import annotations

import csv
from io import StringIO
from datetime import datetime, timezone
from typing import Optional

from flask import Flask, Response, jsonify, render_template, request
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy import desc, false, inspect, text

from program_parser import parse_mlb26_program_html

db = SQLAlchemy()


class Event(db.Model):
    __tablename__ = "events"

    id = db.Column(db.Integer, primary_key=True)
    outcome = db.Column(db.String(20), nullable=False, index=True)
    difficulty_level = db.Column(db.String(20), nullable=True, index=True)
    game_mode = db.Column(db.String(20), nullable=True, index=True)
    created_at = db.Column(
        db.DateTime,
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "outcome": self.outcome,
            "difficulty_level": self.difficulty_level,
            "game_mode": self.game_mode,
            "created_at": self.created_at.isoformat().replace("+00:00", "Z"),
        }


class BabipEvent(db.Model):
    __tablename__ = "babip_events"

    id = db.Column(db.Integer, primary_key=True)
    outcome = db.Column(db.String(20), nullable=False, index=True)
    difficulty_level = db.Column(db.String(20), nullable=True, index=True)
    game_mode = db.Column(db.String(20), nullable=True, index=True)
    created_at = db.Column(
        db.DateTime,
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "outcome": self.outcome,
            "difficulty_level": self.difficulty_level,
            "game_mode": self.game_mode,
            "created_at": self.created_at.isoformat().replace("+00:00", "Z"),
        }


class Program(db.Model):
    __tablename__ = "programs"

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(160), nullable=False)
    description = db.Column(db.Text, nullable=False, default="")
    total_stars = db.Column(db.Integer, nullable=False)
    created_at = db.Column(
        db.DateTime,
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )
    updated_at = db.Column(
        db.DateTime,
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )
    categories = db.relationship(
        "ProgramCategory",
        back_populates="program",
        cascade="all, delete-orphan",
        order_by="ProgramCategory.sort_order, ProgramCategory.id",
    )


class ProgramCategory(db.Model):
    __tablename__ = "program_categories"

    id = db.Column(db.Integer, primary_key=True)
    program_id = db.Column(
        db.Integer,
        db.ForeignKey("programs.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name = db.Column(db.String(160), nullable=False)
    description = db.Column(db.Text, nullable=False, default="")
    sort_order = db.Column(db.Integer, nullable=False, default=0)
    program = db.relationship("Program", back_populates="categories")
    tasks = db.relationship(
        "ProgramTask",
        back_populates="category",
        cascade="all, delete-orphan",
        order_by="ProgramTask.sort_order, ProgramTask.id",
    )


class ProgramTask(db.Model):
    __tablename__ = "program_tasks"

    id = db.Column(db.Integer, primary_key=True)
    category_id = db.Column(
        db.Integer,
        db.ForeignKey("program_categories.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    title = db.Column(db.String(200), nullable=False)
    description = db.Column(db.Text, nullable=False, default="")
    target_value = db.Column(db.Integer, nullable=False)
    current_value = db.Column(db.Integer, nullable=False, default=0)
    reward_stars = db.Column(db.Integer, nullable=False)
    sort_order = db.Column(db.Integer, nullable=False, default=0)
    category = db.relationship("ProgramCategory", back_populates="tasks")


VALID_OUTCOMES = {"out", "single", "double", "triple", "home_run"}
DIFFICULTY_LEVEL_ORDER = [
    "rookie",
    "veteran",
    "all_star",
    "hall_of_fame",
    "legend",
    "goat",
]
DIFFICULTY_LEVEL_LABELS = {
    "rookie": "Rookie",
    "veteran": "Veteran",
    "all_star": "All-Star",
    "hall_of_fame": "Hall of Fame",
    "legend": "Legend",
    "goat": "G.O.A.T.",
}
VALID_DIFFICULTY_LEVELS = {
    "rookie",
    "veteran",
    "all_star",
    "hall_of_fame",
    "legend",
    "goat",
}
GAME_MODE_ORDER = [
    "conquest",
    "ranked",
    "events",
    "moments",
    "diamond_quest",
    "showdown",
    "vs_cpu",
    "miniseasons",
]
GAME_MODE_LABELS = {
    "conquest": "Conquest",
    "ranked": "Ranked",
    "events": "Events",
    "moments": "Moments",
    "diamond_quest": "Diamond Quest",
    "showdown": "Showdown",
    "vs_cpu": "vs CPU",
    "miniseasons": "Miniseasons",
}
VALID_GAME_MODES = {
    "conquest",
    "ranked",
    "events",
    "moments",
    "diamond_quest",
    "showdown",
    "vs_cpu",
    "miniseasons",
}
VALID_LIMITS = {50, 100, 200, 500}


def format_outcome_label(outcome: str) -> str:
    return outcome.replace("_", " ").title()


def ensure_event_columns() -> None:
    for model in (Event, BabipEvent):
        existing_columns = {
            column["name"]
            for column in inspect(db.engine).get_columns(model.__tablename__)
        }

        with db.engine.begin() as connection:
            if "difficulty_level" not in existing_columns:
                connection.execute(text(f"ALTER TABLE {model.__tablename__} ADD COLUMN difficulty_level VARCHAR(20)"))
            if "game_mode" not in existing_columns:
                connection.execute(text(f"ALTER TABLE {model.__tablename__} ADD COLUMN game_mode VARCHAR(20)"))


def create_app(config: Optional[dict] = None) -> Flask:
    app = Flask(__name__)
    app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///baseball_hits.db"
    app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
    app.config["MAX_CONTENT_LENGTH"] = 2 * 1024 * 1024
    if config:
        app.config.update(config)

    db.init_app(app)

    with app.app_context():
        db.create_all()
        ensure_event_columns()

    @app.route("/")
    def index():
        return render_template("index.html", active_page="home")

    @app.route("/reports")
    def reports():
        return render_template("reports.html", active_page="reports")

    @app.route("/babip")
    def babip():
        return render_template(
            "babip.html",
            active_page="babip",
            difficulty_options=[
                (key, DIFFICULTY_LEVEL_LABELS[key]) for key in DIFFICULTY_LEVEL_ORDER
            ],
            game_mode_options=[
                (key, GAME_MODE_LABELS[key]) for key in GAME_MODE_ORDER
            ],
        )

    @app.route("/programs")
    def programs():
        return render_template("programs.html", active_page="programs")

    @app.route("/programs/manage")
    def manage_programs():
        return render_template("program_manage.html", active_page="programs")

    @app.get("/api/programs")
    def get_programs():
        return jsonify({
            "programs": [
                serialize_program(program, include_categories=False)
                for program in Program.query.order_by(desc(Program.updated_at), Program.name).all()
            ]
        }), 200

    @app.get("/api/programs/<int:program_id>")
    def get_program(program_id: int):
        program = db.get_or_404(Program, program_id)
        return jsonify({"program": serialize_program(program)}), 200

    @app.post("/api/programs")
    def add_program():
        payload = request.get_json(silent=True) or {}
        errors = validate_program_payload(payload, require_task=True)
        if errors:
            return jsonify({"error": errors[0], "errors": errors}), 400

        program = Program(
            name=clean_text(payload.get("name")),
            description=clean_text(payload.get("description")),
            total_stars=int(payload["total_stars"]),
        )
        db.session.add(program)

        initial_task = payload.get("initial_task") or {}
        category = ProgramCategory(
            program=program,
            name=clean_text(initial_task.get("category")),
            sort_order=0,
        )
        db.session.add(category)
        db.session.add(ProgramTask(
            category=category,
            title=clean_text(initial_task.get("title")),
            description=clean_text(initial_task.get("description")),
            target_value=int(initial_task["target_value"]),
            reward_stars=int(initial_task["reward_stars"]),
            current_value=0,
            sort_order=0,
        ))
        db.session.commit()
        return jsonify({
            "message": "Program created.",
            "program": serialize_program(program),
        }), 201

    @app.patch("/api/programs/<int:program_id>")
    def update_program(program_id: int):
        program = db.get_or_404(Program, program_id)
        payload = request.get_json(silent=True) or {}

        name = clean_text(payload.get("name", program.name))
        description = clean_text(payload.get("description", program.description))
        total_stars = parse_positive_int(payload.get("total_stars", program.total_stars))
        if not name:
            return jsonify({"error": "Program name is required."}), 400
        if total_stars is None:
            return jsonify({"error": "Total stars must be a positive whole number."}), 400

        program.name = name
        program.description = description
        program.total_stars = total_stars
        db.session.commit()
        return jsonify({
            "message": "Program updated.",
            "program": serialize_program(program),
        }), 200

    @app.delete("/api/programs/<int:program_id>")
    def delete_program(program_id: int):
        program = db.get_or_404(Program, program_id)
        program_name = program.name
        db.session.delete(program)
        db.session.commit()
        return jsonify({"message": f"{program_name} deleted."}), 200

    @app.post("/api/programs/<int:program_id>/tasks")
    def add_program_task(program_id: int):
        program = db.get_or_404(Program, program_id)
        payload = request.get_json(silent=True) or {}
        errors = validate_task_payload(payload)
        if errors:
            return jsonify({"error": errors[0], "errors": errors}), 400

        category_name = clean_text(payload.get("category"))
        category = next(
            (
                candidate
                for candidate in program.categories
                if candidate.name.casefold() == category_name.casefold()
            ),
            None,
        )
        if category is None:
            category = ProgramCategory(
                program=program,
                name=category_name,
                sort_order=len(program.categories),
            )
            db.session.add(category)

        task = ProgramTask(
            category=category,
            title=clean_text(payload.get("title")),
            description=clean_text(payload.get("description")),
            target_value=int(payload["target_value"]),
            reward_stars=int(payload["reward_stars"]),
            current_value=0,
            sort_order=len(category.tasks),
        )
        db.session.add(task)
        program.updated_at = datetime.now(timezone.utc)
        db.session.commit()
        return jsonify({
            "message": "Task added.",
            "program": serialize_program(program),
        }), 201

    @app.patch("/api/program-tasks/<int:task_id>")
    def update_program_task(task_id: int):
        task = db.get_or_404(ProgramTask, task_id)
        payload = request.get_json(silent=True) or {}

        title = clean_text(payload.get("title", task.title))
        description = clean_text(payload.get("description", task.description))
        target_value = parse_positive_int(payload.get("target_value", task.target_value))
        reward_stars = parse_nonnegative_int(payload.get("reward_stars", task.reward_stars))
        current_value = parse_nonnegative_int(payload.get("current_value", task.current_value))
        category_name = clean_text(payload.get("category", task.category.name))
        if not title or not category_name:
            return jsonify({"error": "Category and task name are required."}), 400
        if target_value is None or reward_stars is None or current_value is None:
            return jsonify({"error": "Task values must be valid whole numbers."}), 400

        program = task.category.program
        if category_name.casefold() != task.category.name.casefold():
            category = next(
                (
                    candidate
                    for candidate in program.categories
                    if candidate.name.casefold() == category_name.casefold()
                ),
                None,
            )
            if category is None:
                category = ProgramCategory(
                    program=program,
                    name=category_name,
                    sort_order=len(program.categories),
                )
                db.session.add(category)
            task.category = category
            task.sort_order = len(category.tasks)

        task.title = title
        task.description = description
        task.target_value = target_value
        task.reward_stars = reward_stars
        task.current_value = min(current_value, target_value)
        program.updated_at = datetime.now(timezone.utc)
        db.session.commit()
        return jsonify({
            "message": "Task updated.",
            "program": serialize_program(program),
        }), 200

    @app.post("/api/program-tasks/<int:task_id>/progress")
    def update_task_progress(task_id: int):
        task = db.get_or_404(ProgramTask, task_id)
        payload = request.get_json(silent=True) or {}
        current_value = parse_nonnegative_int(payload.get("current_value"))
        if current_value is None:
            return jsonify({"error": "Progress must be a non-negative whole number."}), 400

        task.current_value = min(current_value, task.target_value)
        task.category.program.updated_at = datetime.now(timezone.utc)
        db.session.commit()
        return jsonify({
            "message": "Progress updated.",
            "program": serialize_program(task.category.program),
        }), 200

    @app.delete("/api/program-tasks/<int:task_id>")
    def delete_program_task(task_id: int):
        task = db.get_or_404(ProgramTask, task_id)
        program = task.category.program
        category = task.category
        db.session.delete(task)
        db.session.flush()
        if ProgramTask.query.filter_by(category_id=category.id).first() is None:
            db.session.delete(category)
        program.updated_at = datetime.now(timezone.utc)
        db.session.commit()
        return jsonify({
            "message": "Task removed.",
            "program": serialize_program(program),
        }), 200

    @app.post("/api/programs/import-preview")
    def preview_program_import():
        payload = request.get_json(silent=True) or {}
        html = str(payload.get("html", ""))
        if not html.strip():
            return jsonify({"error": "Paste MLB26 program HTML to preview."}), 400

        categories = parse_mlb26_program_html(html)
        task_count = sum(len(category["tasks"]) for category in categories)
        if not categories or not task_count:
            return jsonify({
                "error": "No MLB26 program categories and tasks were found in that HTML."
            }), 400
        return jsonify({
            "categories": categories,
            "category_count": len(categories),
            "task_count": task_count,
        }), 200

    @app.post("/api/programs/import")
    def import_program():
        payload = request.get_json(silent=True) or {}
        name = clean_text(payload.get("name"))
        description = clean_text(payload.get("description"))
        total_stars = parse_positive_int(payload.get("total_stars"))
        html = str(payload.get("html", ""))
        if not name:
            return jsonify({"error": "Program name is required."}), 400
        if total_stars is None:
            return jsonify({"error": "Total stars must be a positive whole number."}), 400

        categories = parse_mlb26_program_html(html)
        task_count = sum(len(category["tasks"]) for category in categories)
        if not categories or not task_count:
            return jsonify({
                "error": "No MLB26 program categories and tasks were found in that HTML."
            }), 400

        program = Program(name=name, description=description, total_stars=total_stars)
        db.session.add(program)
        for category_index, category_data in enumerate(categories):
            category = ProgramCategory(
                program=program,
                name=category_data["name"],
                description=category_data["description"],
                sort_order=category_index,
            )
            db.session.add(category)
            for task_index, task_data in enumerate(category_data["tasks"]):
                db.session.add(ProgramTask(
                    category=category,
                    sort_order=task_index,
                    **task_data,
                ))

        db.session.commit()
        return jsonify({
            "message": f"Imported {task_count} tasks across {len(categories)} categories.",
            "program": serialize_program(program),
        }), 201

    @app.get("/api/stats")
    def get_stats():
        limit = parse_limit(request.args.get("limit", "all"))
        if limit == "invalid":
            return jsonify({"error": "limit must be one of: all, 50, 100, 200, 500"}), 400
        difficulty_levels, game_modes = parse_stats_filters()
        if difficulty_levels == "invalid":
            return jsonify({"error": "Invalid difficulty filter"}), 400
        if game_modes == "invalid":
            return jsonify({"error": "Invalid game mode filter"}), 400

        return jsonify(calculate_stats(Event, limit, difficulty_levels, game_modes)), 200

    @app.get("/api/events")
    def get_events():
        limit = parse_limit(request.args.get("limit", "50"))
        if limit == "invalid":
            return jsonify({"error": "limit must be one of: all, 50, 100, 200, 500"}), 400

        query = Event.query.order_by(desc(Event.id))
        if isinstance(limit, int):
            query = query.limit(limit)

        events = [event.to_dict() for event in query.all()]
        return jsonify({"events": events}), 200

    @app.get("/api/events/export")
    def export_events():
        return build_csv_export_response(Event, "shotrax-perfect-perfect-events.csv")

    @app.get("/api/reports")
    def get_reports():
        return jsonify(build_reports_payload()), 200

    @app.post("/api/events")
    def add_event():
        payload = request.get_json(silent=True) or request.form
        outcome = str(payload.get("outcome", "")).strip().lower()
        difficulty_level = str(payload.get("difficulty_level", "")).strip().lower()
        game_mode = str(payload.get("game_mode", "")).strip().lower()

        if outcome not in VALID_OUTCOMES:
            return jsonify({"error": "Invalid outcome"}), 400
        if difficulty_level not in VALID_DIFFICULTY_LEVELS:
            return jsonify({"error": "Invalid difficulty level"}), 400
        if game_mode not in VALID_GAME_MODES:
            return jsonify({"error": "Invalid game mode"}), 400
        if difficulty_level == "goat" and game_mode != "diamond_quest":
            return jsonify({"error": "G.O.A.T. difficulty is only available for Diamond Quest"}), 400

        event = Event(
            outcome=outcome,
            difficulty_level=difficulty_level,
            game_mode=game_mode,
        )
        db.session.add(event)
        db.session.commit()

        return jsonify({
            "message": f"{format_outcome_label(outcome)} Recorded.",
            "event": event.to_dict(),
        }), 201

    @app.get("/api/babip/stats")
    def get_babip_stats():
        limit = parse_limit(request.args.get("limit", "all"))
        if limit == "invalid":
            return jsonify({"error": "limit must be one of: all, 50, 100, 200, 500"}), 400
        difficulty_levels, game_modes = parse_stats_filters()
        if difficulty_levels == "invalid":
            return jsonify({"error": "Invalid difficulty filter"}), 400
        if game_modes == "invalid":
            return jsonify({"error": "Invalid game mode filter"}), 400

        return jsonify(calculate_stats(BabipEvent, limit, difficulty_levels, game_modes)), 200

    @app.get("/api/babip/events")
    def get_babip_events():
        limit = parse_limit(request.args.get("limit", "50"))
        if limit == "invalid":
            return jsonify({"error": "limit must be one of: all, 50, 100, 200, 500"}), 400

        query = BabipEvent.query.order_by(desc(BabipEvent.id))
        if isinstance(limit, int):
            query = query.limit(limit)

        events = [event.to_dict() for event in query.all()]
        return jsonify({"events": events}), 200

    @app.get("/api/babip/events/export")
    def export_babip_events():
        return build_csv_export_response(BabipEvent, "shotrax-babip-events.csv")

    @app.post("/api/babip/events")
    def add_babip_event():
        payload = request.get_json(silent=True) or request.form
        outcome = str(payload.get("outcome", "")).strip().lower()
        difficulty_level = str(payload.get("difficulty_level", "")).strip().lower()
        game_mode = str(payload.get("game_mode", "")).strip().lower()

        if outcome not in VALID_OUTCOMES:
            return jsonify({"error": "Invalid outcome"}), 400
        if difficulty_level not in VALID_DIFFICULTY_LEVELS:
            return jsonify({"error": "Invalid difficulty level"}), 400
        if game_mode not in VALID_GAME_MODES:
            return jsonify({"error": "Invalid game mode"}), 400
        if difficulty_level == "goat" and game_mode != "diamond_quest":
            return jsonify({"error": "G.O.A.T. difficulty is only available for Diamond Quest"}), 400

        event = BabipEvent(
            outcome=outcome,
            difficulty_level=difficulty_level,
            game_mode=game_mode,
        )
        db.session.add(event)
        db.session.commit()

        return jsonify({
            "message": f"{format_outcome_label(outcome)} Recorded.",
            "event": event.to_dict(),
        }), 201

    @app.delete("/api/events/last")
    def delete_last_event():
        last_event = Event.query.order_by(desc(Event.id)).first()

        if last_event is None:
            return jsonify({"error": "No events exist to delete."}), 404

        deleted_event = last_event.to_dict()
        db.session.delete(last_event)
        db.session.commit()

        payload = build_response_payload(Event, "Last event deleted.")
        payload["deleted_event"] = deleted_event
        return jsonify(payload), 200

    @app.delete("/api/events")
    def delete_all_events():
        Event.query.delete()
        db.session.commit()

        payload = build_response_payload(Event, "All events deleted.")
        return jsonify(payload), 200

    @app.delete("/api/babip/events/last")
    def delete_last_babip_event():
        last_event = BabipEvent.query.order_by(desc(BabipEvent.id)).first()

        if last_event is None:
            return jsonify({"error": "No BABIP events exist to delete."}), 404

        deleted_event = last_event.to_dict()
        db.session.delete(last_event)
        db.session.commit()

        payload = build_response_payload(BabipEvent, "Last BABIP event deleted.")
        payload["deleted_event"] = deleted_event
        return jsonify(payload), 200

    @app.delete("/api/babip/events")
    def delete_all_babip_events():
        BabipEvent.query.delete()
        db.session.commit()

        payload = build_response_payload(BabipEvent, "All BABIP events deleted.")
        return jsonify(payload), 200

    return app


def parse_limit(value: Optional[str]) -> Optional[int] | str:
    if value is None:
        return None

    value = value.strip().lower()
    if value == "all":
        return None

    try:
        parsed = int(value)
    except ValueError:
        return "invalid"

    return parsed if parsed in VALID_LIMITS else "invalid"


def parse_filter_values(value: Optional[str], valid_values: set[str]) -> list[str] | None | str:
    if value is None:
        return None

    value = value.strip().lower()
    if value == "":
        return []

    parsed_values = list(dict.fromkeys(item.strip() for item in value.split(",") if item.strip()))
    if any(item not in valid_values for item in parsed_values):
        return "invalid"
    if set(parsed_values) == valid_values:
        return None

    return parsed_values


def parse_stats_filters() -> tuple[list[str] | None | str, list[str] | None | str]:
    difficulty_levels = parse_filter_values(request.args.get("difficulty_levels"), VALID_DIFFICULTY_LEVELS)
    game_modes = parse_filter_values(request.args.get("game_modes"), VALID_GAME_MODES)
    return difficulty_levels, game_modes


def apply_event_filters(model, query, difficulty_levels: list[str] | None = None, game_modes: list[str] | None = None):
    if difficulty_levels is not None:
        query = query.filter(false()) if not difficulty_levels else query.filter(model.difficulty_level.in_(difficulty_levels))

    if game_modes is not None:
        query = query.filter(false()) if not game_modes else query.filter(model.game_mode.in_(game_modes))

    return query


def fetch_outcomes(
    model,
    limit: Optional[int] = None,
    difficulty_levels: list[str] | None = None,
    game_modes: list[str] | None = None,
) -> list[str]:
    query = model.query.with_entities(model.outcome).order_by(desc(model.id))
    query = apply_event_filters(model, query, difficulty_levels, game_modes)
    if isinstance(limit, int):
        query = query.limit(limit)

    return [row.outcome for row in query.all()]


def calculate_rate_stats_from_outcomes(outcomes: list[str]) -> dict:
    at_bats = len(outcomes)
    singles = outcomes.count("single")
    doubles = outcomes.count("double")
    triples = outcomes.count("triple")
    home_runs = outcomes.count("home_run")
    outs = outcomes.count("out")

    hits = singles + doubles + triples + home_runs
    total_bases = singles + (2 * doubles) + (3 * triples) + (4 * home_runs)
    batting_average = (hits / at_bats) if at_bats else 0.0
    slugging_percentage = (total_bases / at_bats) if at_bats else 0.0
    ops = batting_average + slugging_percentage

    return {
        "at_bats": at_bats,
        "outs": outs,
        "hits": hits,
        "singles": singles,
        "doubles": doubles,
        "triples": triples,
        "home_runs": home_runs,
        "total_bases": total_bases,
        "batting_average": f"{batting_average:.3f}",
        "slugging_percentage": f"{slugging_percentage:.3f}",
        "ops": f"{ops:.3f}",
    }


def calculate_stats(
    model,
    limit: Optional[int] = None,
    difficulty_levels: list[str] | None = None,
    game_modes: list[str] | None = None,
) -> dict:
    outcomes = fetch_outcomes(model, limit, difficulty_levels, game_modes)
    stats = calculate_rate_stats_from_outcomes(outcomes)

    return {
        "sample_size": "all" if limit is None else limit,
        **stats,
        "on_base_percentage": stats["batting_average"],
    }


def build_reports_payload() -> dict:
    report_events = Event.query.filter(
        Event.difficulty_level.is_not(None),
        Event.game_mode.is_not(None),
    ).all()

    outcomes_by_difficulty = {difficulty: [] for difficulty in DIFFICULTY_LEVEL_ORDER}
    outcomes_by_mode_and_difficulty = {
        game_mode: {difficulty: [] for difficulty in DIFFICULTY_LEVEL_ORDER}
        for game_mode in GAME_MODE_ORDER
    }

    for event in report_events:
        if event.difficulty_level not in VALID_DIFFICULTY_LEVELS or event.game_mode not in VALID_GAME_MODES:
            continue

        outcomes_by_difficulty[event.difficulty_level].append(event.outcome)
        outcomes_by_mode_and_difficulty[event.game_mode][event.difficulty_level].append(event.outcome)

    difficulties = []
    for difficulty in DIFFICULTY_LEVEL_ORDER:
        difficulties.append({
            "key": difficulty,
            "label": DIFFICULTY_LEVEL_LABELS[difficulty],
            **calculate_rate_stats_from_outcomes(outcomes_by_difficulty[difficulty]),
        })

    game_modes = []
    for game_mode in GAME_MODE_ORDER:
        game_modes.append({
            "key": game_mode,
            "label": GAME_MODE_LABELS[game_mode],
            "difficulties": [
                {
                    "key": difficulty,
                    "label": DIFFICULTY_LEVEL_LABELS[difficulty],
                    **calculate_rate_stats_from_outcomes(outcomes_by_mode_and_difficulty[game_mode][difficulty]),
                }
                for difficulty in DIFFICULTY_LEVEL_ORDER
            ],
        })

    return {
        "difficulties": difficulties,
        "game_modes": game_modes,
    }


def build_response_payload(model, message: str) -> dict:
    stats_limit = parse_limit(request.args.get("stats_limit", "all"))
    if stats_limit == "invalid":
        stats_limit = None

    history_limit = parse_limit(request.args.get("history_limit", "50"))
    if history_limit == "invalid":
        history_limit = 50

    difficulty_levels, game_modes = parse_stats_filters()
    if difficulty_levels == "invalid":
        difficulty_levels = None
    if game_modes == "invalid":
        game_modes = None

    stats = calculate_stats(model, stats_limit, difficulty_levels, game_modes)

    events_query = model.query.order_by(desc(model.id))
    if isinstance(history_limit, int):
        events_query = events_query.limit(history_limit)

    events = [row.to_dict() for row in events_query.all()]

    return {
        "message": message,
        "stats": stats,
        "events": events,
    }


def build_csv_export_response(model, filename: str) -> Response:
    output = StringIO()
    writer = csv.writer(output)
    writer.writerow(["id", "outcome", "difficulty_level", "game_mode", "created_at"])

    for event in model.query.order_by(model.id).all():
        writer.writerow([
            event.id,
            event.outcome,
            event.difficulty_level or "",
            event.game_mode or "",
            event.created_at.isoformat().replace("+00:00", "Z"),
        ])

    return Response(
        output.getvalue(),
        mimetype="text/csv",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


def clean_text(value) -> str:
    return str(value or "").strip()


def parse_positive_int(value) -> int | None:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return None
    return parsed if 0 < parsed <= 1_000_000 else None


def parse_nonnegative_int(value) -> int | None:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return None
    return parsed if 0 <= parsed <= 1_000_000 else None


def validate_task_payload(payload: dict) -> list[str]:
    errors: list[str] = []
    if not clean_text(payload.get("category")):
        errors.append("Category is required.")
    if not clean_text(payload.get("title")):
        errors.append("Task name is required.")
    if parse_positive_int(payload.get("target_value")) is None:
        errors.append("Task value must be a positive whole number.")
    if parse_nonnegative_int(payload.get("reward_stars")) is None:
        errors.append("Reward stars must be a non-negative whole number.")
    return errors


def validate_program_payload(payload: dict, require_task: bool = False) -> list[str]:
    errors: list[str] = []
    if not clean_text(payload.get("name")):
        errors.append("Program name is required.")
    if parse_positive_int(payload.get("total_stars")) is None:
        errors.append("Total stars must be a positive whole number.")
    if require_task:
        errors.extend(validate_task_payload(payload.get("initial_task") or {}))
    return errors


def serialize_task(task: ProgramTask) -> dict:
    completed = task.current_value >= task.target_value
    return {
        "id": task.id,
        "category_id": task.category_id,
        "category": task.category.name,
        "title": task.title,
        "description": task.description,
        "target_value": task.target_value,
        "current_value": task.current_value,
        "reward_stars": task.reward_stars,
        "completed": completed,
        "progress_percent": round(min(100, (task.current_value / task.target_value) * 100), 1),
    }


def serialize_program(program: Program, include_categories: bool = True) -> dict:
    tasks = [task for category in program.categories for task in category.tasks]
    completed_tasks = [task for task in tasks if task.current_value >= task.target_value]
    earned_stars = sum(task.reward_stars for task in completed_tasks)
    available_stars = sum(task.reward_stars for task in tasks)
    remaining_stars = max(0, program.total_stars - earned_stars)
    progress_percent = round(
        min(100, (earned_stars / program.total_stars) * 100),
        1,
    )

    payload = {
        "id": program.id,
        "name": program.name,
        "description": program.description,
        "total_stars": program.total_stars,
        "earned_stars": earned_stars,
        "available_stars": available_stars,
        "remaining_stars": remaining_stars,
        "progress_percent": progress_percent,
        "task_count": len(tasks),
        "completed_task_count": len(completed_tasks),
        "category_count": len(program.categories),
        "status": (
            "Complete"
            if earned_stars >= program.total_stars
            else "In progress"
            if any(task.current_value > 0 for task in tasks)
            else "Not started"
        ),
        "updated_at": program.updated_at.isoformat().replace("+00:00", "Z"),
    }
    if not include_categories:
        return payload

    payload["categories"] = []
    for category in program.categories:
        category_tasks = list(category.tasks)
        category_completed = [
            task
            for task in category_tasks
            if task.current_value >= task.target_value
        ]
        category_earned = sum(task.reward_stars for task in category_completed)
        category_available = sum(task.reward_stars for task in category_tasks)
        payload["categories"].append({
            "id": category.id,
            "name": category.name,
            "description": category.description,
            "task_count": len(category_tasks),
            "completed_task_count": len(category_completed),
            "earned_stars": category_earned,
            "available_stars": category_available,
            "progress_percent": round(
                (len(category_completed) / len(category_tasks)) * 100,
                1,
            ) if category_tasks else 0,
            "tasks": [serialize_task(task) for task in category_tasks],
        })
    return payload


app = create_app()

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8000, debug=False)
