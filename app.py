from __future__ import annotations

import csv
from io import StringIO
from datetime import datetime, timezone
from typing import Optional

from flask import Flask, Response, jsonify, render_template, request
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy import desc, false, inspect, text

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


def create_app() -> Flask:
    app = Flask(__name__)
    app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///baseball_hits.db"
    app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False

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


app = create_app()

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8000, debug=False)
