from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from flask import Flask, jsonify, render_template, request
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy import desc

db = SQLAlchemy()


class Event(db.Model):
    __tablename__ = "events"

    id = db.Column(db.Integer, primary_key=True)
    outcome = db.Column(db.String(20), nullable=False, index=True)
    created_at = db.Column(
        db.DateTime,
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "outcome": self.outcome,
            "created_at": self.created_at.isoformat().replace("+00:00", "Z"),
        }


VALID_OUTCOMES = {"out", "single", "double", "triple", "home_run"}
VALID_LIMITS = {50, 100, 200, 500}


def format_outcome_label(outcome: str) -> str:
    return outcome.replace("_", " ").title()


def create_app() -> Flask:
    app = Flask(__name__)
    app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///baseball_hits.db"
    app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False

    db.init_app(app)

    with app.app_context():
        db.create_all()

    @app.route("/")
    def index():
        return render_template("index.html")

    @app.get("/api/stats")
    def get_stats():
        limit = parse_limit(request.args.get("limit", "all"))
        if limit == "invalid":
            return jsonify({"error": "limit must be one of: all, 50, 100, 200, 500"}), 400

        return jsonify(calculate_stats(limit)), 200

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

    @app.post("/api/events")
    def add_event():
        payload = request.get_json(silent=True) or request.form
        outcome = str(payload.get("outcome", "")).strip().lower()

        if outcome not in VALID_OUTCOMES:
            return jsonify({"error": "Invalid outcome"}), 400

        event = Event(outcome=outcome)
        db.session.add(event)
        db.session.commit()

        return jsonify(build_response_payload(f"{format_outcome_label(outcome)} Recorded.")), 201

    @app.delete("/api/events/last")
    def delete_last_event():
        last_event = Event.query.order_by(desc(Event.id)).first()

        if last_event is None:
            return jsonify({"error": "No events exist to delete."}), 404

        deleted_event = last_event.to_dict()
        db.session.delete(last_event)
        db.session.commit()

        payload = build_response_payload("Last event deleted.")
        payload["deleted_event"] = deleted_event
        return jsonify(payload), 200

    @app.delete("/api/events")
    def delete_all_events():
        Event.query.delete()
        db.session.commit()

        payload = build_response_payload("All events deleted.")
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


def fetch_outcomes(limit: Optional[int] = None) -> list[str]:
    query = Event.query.with_entities(Event.outcome).order_by(desc(Event.id))
    if isinstance(limit, int):
        query = query.limit(limit)

    return [row.outcome for row in query.all()]


def calculate_stats(limit: Optional[int] = None) -> dict:
    outcomes = fetch_outcomes(limit)

    at_bats = len(outcomes)
    singles = outcomes.count("single")
    doubles = outcomes.count("double")
    triples = outcomes.count("triple")
    home_runs = outcomes.count("home_run")
    outs = outcomes.count("out")

    hits = singles + doubles + triples + home_runs
    total_bases = singles + (2 * doubles) + (3 * triples) + (4 * home_runs)

    # Simplified model:
    # No BB, HBP, or SF are tracked, so OBP == AVG in this version.
    batting_average = (hits / at_bats) if at_bats else 0.0
    on_base_percentage = batting_average
    slugging_percentage = (total_bases / at_bats) if at_bats else 0.0
    ops = on_base_percentage + slugging_percentage

    return {
        "sample_size": "all" if limit is None else limit,
        "at_bats": at_bats,
        "outs": outs,
        "hits": hits,
        "singles": singles,
        "doubles": doubles,
        "triples": triples,
        "home_runs": home_runs,
        "total_bases": total_bases,
        "batting_average": f"{batting_average:.3f}",
        "on_base_percentage": f"{on_base_percentage:.3f}",
        "slugging_percentage": f"{slugging_percentage:.3f}",
        "ops": f"{ops:.3f}",
    }


def build_response_payload(message: str) -> dict:
    stats_limit = parse_limit(request.args.get("stats_limit", "all"))
    if stats_limit == "invalid":
        stats_limit = None

    history_limit = parse_limit(request.args.get("history_limit", "50"))
    if history_limit == "invalid":
        history_limit = 50

    stats = calculate_stats(stats_limit)

    events_query = Event.query.order_by(desc(Event.id))
    if isinstance(history_limit, int):
        events_query = events_query.limit(history_limit)

    events = [row.to_dict() for row in events_query.all()]

    return {
        "message": message,
        "stats": stats,
        "events": events,
    }


app = create_app()

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8000, debug=False)
