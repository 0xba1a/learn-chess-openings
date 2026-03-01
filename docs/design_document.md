# Chess Mastery System — Development Plan
**Version 2.1 · February 2026**

> A positional understanding system built on a filtered opening DAG, LLM-generated reasoning, and structured puzzles.
>
> **Current scope:** Build-time pipeline only — DAG construction, lesson generation, and puzzle generation. Runtime application (SRS, API, frontend) is deferred to a future phase.

---

## Changelog

### v2.1 (current) — Scope reduction
- Removed SRS engine, API layer, frontend, and update pipeline from current scope
- Focus narrowed to build-time pipeline: DAG + Lessons + Puzzles
- Removed Firebase references from README
- SRS tables kept in schema for forward-compatibility but not implemented yet
- Development phases reduced to 3 (from 7)

### v2.0 — Design review fixes
| Problem | Resolution |
|---|---|
| README ↔ Design Doc architectural contradiction (Firebase vs PostgreSQL/FastAPI) | Unified on PostgreSQL + FastAPI backend, React frontend via Vite, Docker Compose deployment |
| FEN as TEXT primary key (slow joins, wasted storage) | Surrogate `BIGINT` PK with unique index on FEN |
| PGN parser bug: `board.san(move)` called after `board.push(move)` | Fixed: SAN generated before push |
| Memory-unbounded aggregator | Streaming aggregation with bounded dict + incremental DB flush |
| No Stockfish parallelization strategy | Worker pool with configurable concurrency + checkpointing |
| Eval perspective bug in anti-move tagger | Correct sign handling for both eval_before and eval_after |
| LLM pipeline: no error handling, no resume | Retry with exponential backoff, JSON validation, checkpoint table |
| Session builder: no bucket fallback | Overflow system: unfilled buckets redistribute to others |
| Transposition path explosion | Store only top-K canonical paths (K=5), drop rest |
| LLM cost underestimated | Detailed cost model + depth-prioritized generation |
| Puzzle distractor generation hand-waved | Explicit LLM distractor pipeline at build time with fallback heuristics |
| Missing database indexes | Full index strategy for all runtime queries |
| No observability | Structured logging + pipeline progress table |
| Aggressive timeline | Adjusted to 28 weeks with buffer phases |

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [System Architecture](#2-system-architecture)
3. [High Level Design](#3-high-level-design)
4. [Low Level Design](#4-low-level-design)
5. [Development Phases](#5-development-phases)
6. [Future Work](#6-future-work)
7. [Open Questions and Decisions](#7-open-questions-and-decisions)

---

## 1. Project Overview

### Problem Statement
Mastering chess is impossible by studying the full game tree (estimated 10^120 positions). The goal is to build a personalized, data-driven system that:
- Filters the game tree to only positions that matter at a target rating range
- Teaches the *reasoning* behind every move, not just the move itself
- Reinforces learning through position-aware spaced repetition
- Propagates mistakes through the positional graph so related positions are reviewed together

### Core Concepts

**The 10% Rule** — At any position, only moves played in more than 10% of games at the target rating band are included as children. This limits the branching factor to 2–4 per node and makes the tree tractable.

**Anti-moves** — Moves flagged by a chess engine (Stockfish) where evaluation drops beyond a threshold, regardless of how frequently they appear in games. These are explicitly taught as moves to avoid.

**DAG not Tree** — The same chess position can be reached via different move orders (transpositions). The data structure is a Directed Acyclic Graph keyed by FEN string, not a tree. Multiple parent nodes can point to the same child.

**Node-level SRS** — Spaced repetition is applied to positions (nodes), not individual flashcard questions. A mistake on any puzzle for a node triggers a ripple reschedule of neighboring nodes in the graph.

### Scope

**Current (Phases 1–3):**
- Build the opening DAG from Lichess PGN data
- Generate LLM-powered lesson reasoning for every edge
- Generate puzzle definitions for every node
- PostgreSQL as the data store
- All build-time pipeline, no runtime application yet

**General constraints:**
- Opening phase focus (moves 1–20 approximately)
- Configurable rating band (default: 1000–1600 ELO)
- Multi-user ready schema (for future runtime use)
- Starting color selectable (study as Black, White, or both)

**Deferred (future phases):**
- SRS engine with ripple propagation
- REST API (FastAPI)
- React frontend (DAG explorer, lesson view, puzzle UI, dashboard)
- Periodic update pipeline

---

## 2. System Architecture

```
┌─────────────────────────────────────────────────────────┐
│              BUILD-TIME PIPELINE (current scope)        │
│                                                         │
│  Lichess PGN → PGN Parser → Aggregator → DAG Filter    │
│                                 ↓                       │
│                    Transposition Detector                │
│                                 ↓                       │
│                    Stockfish Anti-move Tagger            │
│                                 ↓                       │
│                    ECO Mapper                            │
│                                 ↓                       │
│                    Study Plan Generator (Claude API)     │
│                                 ↓                       │
│                    Puzzle Generator                      │
│                                 ↓                       │
│                    PostgreSQL Database                   │
│                                                         │
│  Pipeline Orchestrator (checkpointing + progress)       │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│              RUNTIME APPLICATION (future)               │
│                                                         │
│   REST API (FastAPI) · SRS Engine · React Frontend      │
└─────────────────────────────────────────────────────────┘
```

### Technology Decision

The pipeline uses **Python** for all processing and **PostgreSQL** for storage. Rationale:

- `python-chess` is the best chess library available (PGN parsing, FEN normalization, board state, Stockfish integration). No JavaScript equivalent matches it.
- PostgreSQL with relational schema is the natural fit for a DAG with rich metadata and graph queries. The schema is designed to support future runtime features (SRS, API) without migration.
- All pipeline steps are Python scripts that can be run independently or orchestrated together.

---

## 3. High Level Design

### 3.1 Component Overview

| Component | Responsibility | Phase |
|---|---|---|
| **DAG Builder** | Parse PGN files, build filtered position graph, tag transpositions | Phase 1 |
| **Anti-move Tagger** | Run Stockfish on every node, flag dangerous moves | Phase 1 |
| **ECO Mapper** | Map FEN positions to opening names via ECO codes | Phase 1 |
| **Study Plan Generator** | Generate per-node reasoning using LLM + engine context | Phase 2 |
| **Puzzle Generator** | Create 6–10 puzzle variants per node from existing data | Phase 3 |

**Deferred components (future phases):**

| Component | Responsibility |
|---|---|
| SRS Engine | Schedule reviews, track mastery, propagate mistakes |
| REST API | Serve all data to frontend, handle user session state |
| React Frontend | Interactive DAG, lesson view, puzzle UI, dashboard |
| Update Pipeline | Diff new PGN data against existing DAG, patch and regenerate |

### 3.2 Data Flow

#### Build-time Flow
```
1. Raw PGN files (Lichess monthly export, filtered by rating + time control)
       ↓
2. PGN Parser — replays every game, records (FEN, move, result) tuples
       ↓
3. Aggregator — groups by FEN, counts move frequencies, calculates win rates
       (streaming with bounded memory, incremental DB upserts)
       ↓
4. DAG Filter — applies 10% threshold, builds parent→child edges
       ↓
5. Transposition Detector — identifies shared FENs across different move paths
       (stores top-5 canonical paths only)
       ↓
6. Stockfish Runner — evaluates every position via worker pool
       (configurable concurrency, checkpoint after each batch)
       ↓
7. ECO Mapper — looks up opening names for known FEN positions
       ↓
8. Study Plan Generator — for each node: passes FEN + context to LLM,
       stores generated reasoning per move
       (retry with backoff, JSON validation, checkpoint per node)
       ↓
9. Puzzle Generator — creates puzzle definitions per node
       (distractors generated via lightweight LLM call, stored statically)
       ↓
10. PostgreSQL — final persisted state, ready for runtime queries
```

#### Runtime Flow (future — not in current scope)

The runtime application (SRS engine, API, frontend) will consume the
pre-generated data in PostgreSQL. This is designed but not yet implemented.

### 3.3 Technology Stack

| Layer | Technology | Reason |
|---|---|---|
| Pipeline Language | Python 3.11+ | `python-chess` library for PGN parsing and FEN handling |
| PGN Parsing | `python-chess` | Best-in-class chess library, handles all edge cases |
| Engine Integration | Stockfish 16 + `stockfish` Python wrapper | Industry standard, free, runs locally |
| LLM Reasoning | Claude API (claude-sonnet-4-6) | Best reasoning quality for chess position explanation |
| Database | PostgreSQL 16 | Handles graph relationships, JSONB for flexible fields |
| Graph Queries | Recursive CTEs | Native PostgreSQL graph traversal, no extensions needed |
| Logging | `structlog` (Python) | Structured JSON logging for pipeline observability |
| Deployment | Docker Compose (PostgreSQL) | Reproducible database setup |

### 3.4 Build-time Pipeline

All current work is **build-time** — expensive computation that runs once and stores results in PostgreSQL.

| Operation | Why build-time |
|---|---|
| PGN parsing | Hours of computation, not acceptable at runtime |
| Stockfish analysis | CPU-intensive, pre-computed and stored |
| LLM reasoning generation | API cost and latency, run once per node |
| Puzzle definition creation | Deterministic from stored data |

---

## 4. Low Level Design

### 4.1 Database Schema

#### Design Decisions
- **Surrogate `BIGINT` IDs** instead of FEN-as-PK. FEN strings are 50–80 characters; using them as foreign keys in every child table wastes storage and slows joins. A `BIGINT` PK + unique index on FEN gives O(1) lookups with compact foreign keys.
- **Explicit indexes** on every column used in runtime WHERE clauses or JOINs.

#### Core Tables

```sql
-- Every unique chess position is a node
CREATE TABLE nodes (
    id                  BIGSERIAL PRIMARY KEY,
    fen                 TEXT NOT NULL UNIQUE,
    name                TEXT,                    -- e.g. "Sicilian Najdorf"
    eco_code            TEXT,                    -- e.g. "B90"
    depth               INTEGER,                 -- half-moves from start
    total_games         INTEGER,                 -- games reaching this position
    white_wins          FLOAT,                   -- win rate 0.0–1.0
    draws               FLOAT,
    black_wins          FLOAT,
    first_seen          DATE,                    -- when first added to DAG
    last_updated        DATE
);

CREATE INDEX idx_nodes_eco ON nodes(eco_code);
CREATE INDEX idx_nodes_depth ON nodes(depth);
CREATE INDEX idx_nodes_name_trgm ON nodes USING gin (name gin_trgm_ops);

-- Directed edges between positions
CREATE TABLE edges (
    id                  BIGSERIAL PRIMARY KEY,
    parent_node_id      BIGINT NOT NULL REFERENCES nodes(id),
    child_node_id       BIGINT NOT NULL REFERENCES nodes(id),
    move_san            TEXT,                    -- e.g. "Nf6" (Standard Algebraic)
    move_uci            TEXT,                    -- e.g. "g8f6" (UCI format)
    frequency           FLOAT,                  -- % of games from parent taking this move
    is_main_line        BOOLEAN,                 -- highest frequency child
    is_anti_move        BOOLEAN DEFAULT FALSE,
    eval_before         FLOAT,                   -- Stockfish centipawn before move
    eval_after          FLOAT,                   -- Stockfish centipawn after move
    eval_drop           FLOAT,                   -- computed: eval_after - eval_before
    UNIQUE (parent_node_id, move_uci)
);

CREATE INDEX idx_edges_parent ON edges(parent_node_id);
CREATE INDEX idx_edges_child ON edges(child_node_id);
CREATE INDEX idx_edges_anti ON edges(is_anti_move) WHERE is_anti_move = TRUE;

-- Transposition tracking — same FEN reachable from multiple parents
-- Stores only top-K paths (default K=5) to prevent explosion
CREATE TABLE transpositions (
    node_id             BIGINT PRIMARY KEY REFERENCES nodes(id),
    canonical_path      TEXT[],                  -- most common move sequence to reach this FEN
    alternative_paths   JSONB,                   -- top-4 other move sequences (capped)
    path_count          INTEGER                  -- total distinct paths (even if not all stored)
);

-- Pre-generated reasoning for each move
CREATE TABLE node_reasoning (
    id                  BIGSERIAL PRIMARY KEY,
    edge_id             BIGINT NOT NULL REFERENCES edges(id),
    color               CHAR(1),                 -- 'w' or 'b' (whose perspective)
    why_play            TEXT,                     -- reasoning to make this move
    why_not             TEXT,                     -- reasoning against anti-moves
    what_opponent_wants TEXT,                     -- if opponent's turn
    game_plan           TEXT,                     -- strategic plan after this move
    key_ideas           TEXT[],                   -- bullet points of key concepts
    generated_at        TIMESTAMP,
    model_version       TEXT,                     -- which LLM version generated this
    prompt_version      TEXT                      -- which prompt template was used
);

CREATE INDEX idx_reasoning_edge ON node_reasoning(edge_id);

-- ECO code reference table
CREATE TABLE eco_codes (
    code                TEXT PRIMARY KEY,         -- e.g. "B20"
    name                TEXT,                     -- e.g. "Sicilian Defence"
    moves               TEXT,                     -- PGN move sequence
    node_id             BIGINT REFERENCES nodes(id)
);
```

#### Puzzle Tables

```sql
CREATE TYPE puzzle_type AS ENUM (
    'best_move',
    'why_this_move',
    'why_not_move',
    'game_plan',
    'consequence',
    'predict_opponent',
    'threat_recognition',
    'best_response',
    'trap_recognition',
    'transposition_awareness'
);

CREATE TABLE puzzles (
    id                  BIGSERIAL PRIMARY KEY,
    node_id             BIGINT NOT NULL REFERENCES nodes(id),
    puzzle_type         puzzle_type NOT NULL,
    color               CHAR(1),                 -- whose perspective
    difficulty_tier     INTEGER CHECK (difficulty_tier BETWEEN 1 AND 5),
    question            TEXT NOT NULL,
    correct_answer      TEXT,                     -- for move puzzles: UCI move
    correct_reasoning   TEXT,                     -- explanation of correct answer
    wrong_options       JSONB,                   -- [{move, reasoning_why_wrong}]
    related_edge_id     BIGINT REFERENCES edges(id)
);

CREATE INDEX idx_puzzles_node ON puzzles(node_id);
CREATE INDEX idx_puzzles_node_type ON puzzles(node_id, puzzle_type);
CREATE INDEX idx_puzzles_tier ON puzzles(difficulty_tier);
```

#### SRS Tables (schema only — not implemented in current scope)

These tables are defined now for forward-compatibility. They will be populated
when the SRS engine is implemented in a future phase.

```sql
CREATE TABLE users (
    id              BIGSERIAL PRIMARY KEY,
    username        TEXT UNIQUE NOT NULL,
    password_hash   TEXT NOT NULL,
    target_rating   INTEGER DEFAULT 1200,
    preferred_color CHAR(1),                    -- 'w', 'b', or NULL for both
    created_at      TIMESTAMP DEFAULT NOW()
);

-- One SRS record per user per node
CREATE TABLE node_srs (
    id                      BIGSERIAL PRIMARY KEY,
    user_id                 BIGINT NOT NULL REFERENCES users(id),
    node_id                 BIGINT NOT NULL REFERENCES nodes(id),

    -- SM-2 core fields
    easiness_factor         FLOAT DEFAULT 2.5,
    interval_days           INTEGER DEFAULT 1,
    next_review_date        DATE DEFAULT CURRENT_DATE,
    last_reviewed           TIMESTAMP,

    -- Performance
    consecutive_correct     INTEGER DEFAULT 0,
    total_attempts          INTEGER DEFAULT 0,
    total_correct           INTEGER DEFAULT 0,
    mastery_score           FLOAT DEFAULT 0.0,

    -- Weak spot tracking
    weak_puzzle_types       puzzle_type[],
    last_mistake_puzzle_id  BIGINT REFERENCES puzzles(id),
    last_mistake_at         TIMESTAMP,

    -- Difficulty progression
    max_difficulty_unlocked INTEGER DEFAULT 1,    -- tiers 1–5

    -- Status
    status                  TEXT DEFAULT 'new',  -- new, learning, reviewing, mastered

    UNIQUE (user_id, node_id)
);

-- Critical indexes for session building
CREATE INDEX idx_srs_user_review ON node_srs(user_id, next_review_date);
CREATE INDEX idx_srs_user_status ON node_srs(user_id, status);
CREATE INDEX idx_srs_user_mistake ON node_srs(user_id, last_mistake_at)
    WHERE last_mistake_at IS NOT NULL;

-- Per-puzzle attempt history
CREATE TABLE puzzle_attempts (
    id              BIGSERIAL PRIMARY KEY,
    user_id         BIGINT NOT NULL REFERENCES users(id),
    puzzle_id       BIGINT NOT NULL REFERENCES puzzles(id),
    node_id         BIGINT NOT NULL REFERENCES nodes(id),
    attempted_at    TIMESTAMP DEFAULT NOW(),
    answer_given    TEXT,
    is_correct      BOOLEAN,
    time_taken_ms   INTEGER,
    self_rating     INTEGER CHECK (self_rating BETWEEN 1 AND 5)
);

CREATE INDEX idx_attempts_user_node ON puzzle_attempts(user_id, node_id);
CREATE INDEX idx_attempts_user_time ON puzzle_attempts(user_id, attempted_at);

-- Ripple events
CREATE TABLE srs_ripple_events (
    id                  BIGSERIAL PRIMARY KEY,
    user_id             BIGINT NOT NULL REFERENCES users(id),
    trigger_node_id     BIGINT NOT NULL REFERENCES nodes(id),
    affected_node_id    BIGINT NOT NULL REFERENCES nodes(id),
    relationship        TEXT,                     -- 'parent', 'sibling', 'child'
    new_review_date     DATE,
    created_at          TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_ripple_user_time ON srs_ripple_events(user_id, created_at);
```

#### Pipeline Progress Table (new in v2)

```sql
-- Tracks build pipeline progress for checkpointing and monitoring
CREATE TABLE pipeline_progress (
    id              BIGSERIAL PRIMARY KEY,
    stage           TEXT NOT NULL,              -- 'pgn_parse', 'stockfish', 'llm_reasoning', 'puzzles'
    node_id         BIGINT REFERENCES nodes(id),
    edge_id         BIGINT REFERENCES edges(id),
    status          TEXT NOT NULL,              -- 'pending', 'processing', 'completed', 'failed'
    error_message   TEXT,
    started_at      TIMESTAMP,
    completed_at    TIMESTAMP,
    retry_count     INTEGER DEFAULT 0
);

CREATE INDEX idx_pipeline_stage_status ON pipeline_progress(stage, status);
```

### 4.2 DAG Builder Pipeline

#### Step 1 — PGN Filtering and Parsing (bug fixed)

```python
# pipeline/pgn_parser.py

import chess.pgn
from dataclasses import dataclass
from typing import Generator

@dataclass
class MoveRecord:
    parent_fen: str
    child_fen: str
    move_uci: str
    move_san: str
    result: str  # '1-0', '0-1', '1/2-1/2'

def filter_game(game: chess.pgn.Game,
                min_rating: int,
                max_rating: int,
                speeds: list[str]) -> bool:
    """Accept only games matching rating band and time control."""
    headers = game.headers
    try:
        white_elo = int(headers.get("WhiteElo", 0))
        black_elo = int(headers.get("BlackElo", 0))
        avg_elo = (white_elo + black_elo) / 2
        time_control = headers.get("TimeControl", "")
        speed = classify_speed(time_control)
        return (min_rating <= avg_elo <= max_rating) and (speed in speeds)
    except (ValueError, TypeError):
        return False

def parse_pgn(filepath: str,
              min_rating: int = 1000,
              max_rating: int = 1600,
              speeds: list[str] = ["blitz", "rapid"],
              max_depth: int = 25) -> Generator[MoveRecord, None, None]:
    """Stream move records from PGN file."""
    with open(filepath) as f:
        while True:
            game = chess.pgn.read_game(f)
            if game is None:
                break
            if not filter_game(game, min_rating, max_rating, speeds):
                continue

            board = game.board()
            result = game.headers.get("Result", "*")
            depth = 0

            for move in game.mainline_moves():
                if depth >= max_depth:
                    break
                parent_fen = normalize_fen(board.fen())

                # FIX: Generate SAN BEFORE pushing the move
                move_san = board.san(move)

                board.push(move)
                child_fen = normalize_fen(board.fen())

                yield MoveRecord(
                    parent_fen=parent_fen,
                    child_fen=child_fen,
                    move_uci=move.uci(),
                    move_san=move_san,
                    result=result
                )
                depth += 1

def normalize_fen(fen: str) -> str:
    """Strip move counters from FEN — only position matters for identity."""
    parts = fen.split()
    return " ".join(parts[:4])  # piece placement, turn, castling, en passant only
```

#### Step 2 — Streaming Aggregation (memory-bounded)

```python
# pipeline/aggregator.py

import structlog
from collections import defaultdict
from contextlib import contextmanager

log = structlog.get_logger()

class StreamingAggregator:
    """
    Aggregates move counts with bounded memory.
    Flushes to DB when the dict reaches max_positions entries,
    using UPSERT to merge with previously flushed data.
    """

    def __init__(self, db_connection, max_positions: int = 100_000):
        self.db = db_connection
        self.max_positions = max_positions
        # {parent_fen: {move_uci: {total, white_wins, black_wins, draws, child_fen, move_san}}}
        self.counts = defaultdict(lambda: defaultdict(lambda: {
            "total": 0, "white_wins": 0, "black_wins": 0, "draws": 0,
            "child_fen": None, "move_san": None
        }))
        self.position_count = 0
        self.total_records = 0
        self.flush_count = 0

    def add(self, record):
        entry = self.counts[record.parent_fen][record.move_uci]
        if entry["total"] == 0:
            self.position_count += 1
        entry["total"] += 1
        entry["child_fen"] = record.child_fen
        entry["move_san"] = record.move_san
        if record.result == "1-0":
            entry["white_wins"] += 1
        elif record.result == "0-1":
            entry["black_wins"] += 1
        else:
            entry["draws"] += 1

        self.total_records += 1

        # Flush when we hit the position cap (not record cap)
        if self.position_count >= self.max_positions:
            self.flush()

    def flush(self):
        """UPSERT current counts to DB and free memory."""
        if not self.counts:
            return
        self.flush_count += 1
        log.info("flushing_aggregator",
                 positions=self.position_count,
                 total_records=self.total_records,
                 flush_number=self.flush_count)
        self._upsert_to_db()
        self.counts.clear()
        self.position_count = 0

    def _upsert_to_db(self):
        """
        Bulk UPSERT into a staging table, then merge.
        Uses ON CONFLICT ... DO UPDATE to accumulate counts
        across multiple flushes.
        """
        with self.db.cursor() as cur:
            for parent_fen, moves in self.counts.items():
                # Ensure parent node exists
                cur.execute("""
                    INSERT INTO nodes (fen, total_games, first_seen)
                    VALUES (%s, 0, CURRENT_DATE)
                    ON CONFLICT (fen) DO NOTHING
                """, (parent_fen,))

                for move_uci, stats in moves.items():
                    # Ensure child node exists
                    cur.execute("""
                        INSERT INTO nodes (fen, total_games, first_seen)
                        VALUES (%s, 0, CURRENT_DATE)
                        ON CONFLICT (fen) DO NOTHING
                    """, (stats["child_fen"],))

                    # Accumulate edge counts
                    cur.execute("""
                        INSERT INTO edges_staging
                            (parent_fen, child_fen, move_uci, move_san,
                             total, white_wins, black_wins, draws)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                        ON CONFLICT (parent_fen, move_uci) DO UPDATE SET
                            total = edges_staging.total + EXCLUDED.total,
                            white_wins = edges_staging.white_wins + EXCLUDED.white_wins,
                            black_wins = edges_staging.black_wins + EXCLUDED.black_wins,
                            draws = edges_staging.draws + EXCLUDED.draws
                    """, (parent_fen, stats["child_fen"], move_uci, stats["move_san"],
                          stats["total"], stats["white_wins"], stats["black_wins"], stats["draws"]))
            self.db.commit()

    def build_dag(self, threshold: float = 0.10):
        """
        After all PGN data is flushed, apply 10% filter from staging to edges.
        Runs as a single SQL operation for efficiency.
        """
        self.flush()  # ensure everything is in DB
        with self.db.cursor() as cur:
            # Compute frequencies and filter
            cur.execute("""
                WITH parent_totals AS (
                    SELECT parent_fen, SUM(total) AS parent_total
                    FROM edges_staging
                    GROUP BY parent_fen
                )
                INSERT INTO edges (parent_node_id, child_node_id, move_san, move_uci,
                                   frequency, is_main_line)
                SELECT
                    pn.id, cn.id, es.move_san, es.move_uci,
                    es.total::FLOAT / pt.parent_total AS frequency,
                    (es.total = MAX(es.total) OVER (PARTITION BY es.parent_fen))
                FROM edges_staging es
                JOIN parent_totals pt ON es.parent_fen = pt.parent_fen
                JOIN nodes pn ON pn.fen = es.parent_fen
                JOIN nodes cn ON cn.fen = es.child_fen
                WHERE es.total::FLOAT / pt.parent_total >= %s
            """, (threshold,))
            self.db.commit()
            log.info("dag_built", threshold=threshold)
```

#### Step 3 — Stockfish Anti-move Detection (fixed eval + parallelization)

```python
# pipeline/engine_tagger.py

import chess
from stockfish import Stockfish
from concurrent.futures import ProcessPoolExecutor
import structlog

log = structlog.get_logger()

class AntiMoveTagger:

    def __init__(self, stockfish_path: str, depth: int = 18,
                 eval_drop_threshold: int = 50):
        self.stockfish_path = stockfish_path
        self.depth = depth
        self.eval_drop_threshold = eval_drop_threshold  # centipawns

    def _create_engine(self) -> Stockfish:
        """Create a fresh Stockfish instance (needed for multiprocessing)."""
        return Stockfish(path=self.stockfish_path, depth=self.depth)

    def evaluate_position(self, engine: Stockfish, fen: str) -> float | None:
        """Returns centipawn evaluation from WHITE's perspective (Stockfish default)."""
        engine.set_fen_position(fen)
        eval_data = engine.get_evaluation()
        if eval_data["type"] == "cp":
            return eval_data["value"]
        # Mate scores: treat as large centipawn value
        if eval_data["type"] == "mate":
            return 10000 if eval_data["value"] > 0 else -10000
        return None

    def tag_edge(self, parent_fen: str, move_uci: str, child_fen: str) -> dict:
        """
        Evaluate a move and return tagging decision.

        FIX: Stockfish always reports from White's perspective.
        We convert to mover's perspective for eval_drop calculation.
        - eval_before: position eval from mover's perspective
        - eval_after: position eval from mover's perspective (after their move)
        """
        engine = self._create_engine()

        raw_eval_before = self.evaluate_position(engine, parent_fen)
        raw_eval_after = self.evaluate_position(engine, child_fen)

        if raw_eval_before is None or raw_eval_after is None:
            return {"is_anti_move": False, "eval_drop": None,
                    "eval_before": None, "eval_after": None}

        board = chess.Board(parent_fen)
        mover_is_white = board.turn == chess.WHITE

        # Convert both evals to mover's perspective
        eval_before = raw_eval_before if mover_is_white else -raw_eval_before
        eval_after = raw_eval_after if mover_is_white else -raw_eval_after

        # After the move, it's the opponent's turn, so the position eval
        # from Stockfish is from the opponent's view. Negate to get mover's view.
        eval_after = -eval_after

        eval_drop = eval_before - eval_after
        is_anti_move = eval_drop > self.eval_drop_threshold

        return {
            "is_anti_move": is_anti_move,
            "eval_before": eval_before,
            "eval_after": eval_after,
            "eval_drop": eval_drop
        }

    def tag_all_edges(self, db, batch_size: int = 100, workers: int = 4):
        """
        Process all untagged edges in batches with parallel workers.
        Checkpoints after each batch so crashes don't lose all progress.
        """
        while True:
            edges = db.get_untagged_edges(limit=batch_size)
            if not edges:
                break

            results = []
            with ProcessPoolExecutor(max_workers=workers) as pool:
                futures = {
                    pool.submit(self.tag_edge, e["parent_fen"], e["move_uci"], e["child_fen"]): e
                    for e in edges
                }
                for future in futures:
                    edge = futures[future]
                    try:
                        tag = future.result(timeout=30)
                        results.append((edge["id"], tag))
                    except Exception as exc:
                        log.error("stockfish_edge_failed",
                                  edge_id=edge["id"], error=str(exc))
                        results.append((edge["id"], {
                            "is_anti_move": False, "eval_drop": None,
                            "eval_before": None, "eval_after": None
                        }))

            # Checkpoint: write batch results to DB
            db.update_edge_tags(results)
            log.info("stockfish_batch_done", processed=len(results))
```

### 4.3 Study Plan Generator (with error handling and checkpointing)

```python
# pipeline/study_plan_generator.py

import anthropic
import chess
import json
import time
import structlog
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type

log = structlog.get_logger()

class StudyPlanGenerator:

    PROMPT_VERSION = "v2.0"

    def __init__(self, api_key: str, model: str = "claude-sonnet-4-6"):
        self.client = anthropic.Anthropic(api_key=api_key)
        self.model = model

    def build_context(self, node: dict, edge: dict, siblings: list) -> str:
        """Build rich context for LLM from stored data."""
        board = chess.Board(node["fen"])

        return f"""
Position: {node["name"] or "Unnamed position"}
FEN: {node["fen"]}
ECO: {node["eco_code"] or "N/A"}
Move played: {edge["move_san"]}
Turn: {"White" if board.turn == chess.WHITE else "Black"}
Depth: Move {node["depth"] // 2 + 1}

Statistics:
- This position appears in {node["total_games"]:,} games
- White wins: {node["white_wins"]*100:.1f}%
- Draws: {node["draws"]*100:.1f}%
- Black wins: {node["black_wins"]*100:.1f}%

Engine evaluation before move: {edge["eval_before"]} centipawns
Engine evaluation after move: {edge["eval_after"]} centipawns
Evaluation change: {edge["eval_drop"]:+.0f} centipawns
Anti-move flag: {"YES — this is a mistake" if edge["is_anti_move"] else "No"}

Other candidate moves from parent position:
{self._format_siblings(siblings)}
"""

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=4, max=60),
        retry=retry_if_exception_type((anthropic.RateLimitError, anthropic.APIConnectionError))
    )
    def _call_llm(self, prompt: str) -> str:
        """Call Claude API with automatic retry on rate limits."""
        response = self.client.messages.create(
            model=self.model,
            max_tokens=800,
            messages=[{"role": "user", "content": prompt}]
        )
        return response.content[0].text

    def _parse_response(self, raw: str) -> dict:
        """
        Parse LLM JSON response with validation.
        Handles markdown code blocks and partial JSON.
        """
        # Strip markdown code fences if present
        text = raw.strip()
        if text.startswith("```"):
            text = text.split("\n", 1)[1]
            if text.endswith("```"):
                text = text[:-3]
            text = text.strip()

        data = json.loads(text)

        # Validate required fields
        required = ["why_play", "game_plan", "key_ideas"]
        for field in required:
            if field not in data or not data[field]:
                raise ValueError(f"Missing required field: {field}")

        if not isinstance(data.get("key_ideas"), list) or len(data["key_ideas"]) < 2:
            raise ValueError("key_ideas must be a list with at least 2 items")

        return data

    def generate_reasoning(self, node: dict, edge: dict,
                           siblings: list, color: str) -> dict | None:
        """Generate human-readable reasoning for a move with full error handling."""
        context = self.build_context(node, edge, siblings)

        prompt = f"""
You are a chess teacher explaining opening moves to a 1200 ELO student.

{context}

Generate clear, practical explanations for a student learning this opening.
Respond in JSON with these exact fields:
{{
  "why_play": "2-3 sentences explaining why this is a good move.",
  "why_not": "If anti-move, explain what goes wrong. Otherwise, what Black gives up by NOT playing this.",
  "what_opponent_wants": "What is the opponent's strategic plan or threat after this move?",
  "game_plan": "Next 2-3 move plan for the {color} player.",
  "key_ideas": ["3-5 concrete takeaway phrases"]
}}

Return ONLY the JSON object, no markdown formatting.
"""
        try:
            raw = self._call_llm(prompt)
            return self._parse_response(raw)
        except json.JSONDecodeError as e:
            log.error("llm_json_parse_failed", edge_id=edge["id"], error=str(e))
            return None
        except ValueError as e:
            log.error("llm_validation_failed", edge_id=edge["id"], error=str(e))
            return None
        except Exception as e:
            log.error("llm_generation_failed", edge_id=edge["id"], error=str(e))
            return None

    def generate_all(self, db, batch_size: int = 50,
                     depth_first: bool = True):
        """
        Process all edges that need reasoning, with checkpointing.
        Processes shallower nodes first (higher priority).
        Rate-limits to ~50 requests/minute to stay under API limits.
        """
        while True:
            edges = db.get_edges_without_reasoning(
                limit=batch_size,
                order_by="depth ASC" if depth_first else "id ASC"
            )
            if not edges:
                break

            for edge in edges:
                node = db.get_node(edge["parent_node_id"])
                siblings = db.get_sibling_edges(edge["parent_node_id"], exclude_edge=edge["id"])
                color = "White" if chess.Board(node["fen"]).turn == chess.WHITE else "Black"

                result = self.generate_reasoning(node, edge, siblings, color)

                if result:
                    db.save_reasoning(edge["id"], color, result,
                                      self.model, self.PROMPT_VERSION)
                    db.mark_pipeline_complete("llm_reasoning", edge_id=edge["id"])
                else:
                    db.mark_pipeline_failed("llm_reasoning", edge_id=edge["id"],
                                            error="Generation returned None")

                # Rate limiting: ~50 req/min = 1.2s between calls
                time.sleep(1.2)

            log.info("llm_batch_done", batch_size=batch_size)

    def _format_siblings(self, siblings: list) -> str:
        return "\n".join([
            f"  - {s['move_san']}: played {s['frequency']*100:.1f}% of games"
            for s in siblings
        ])
```

### 4.4 Puzzle Engine (with distractor generation)

```python
# engine/puzzle_generator.py

import structlog

log = structlog.get_logger()

class PuzzleGenerator:
    """
    Generates puzzle definitions from stored node + edge data.
    Distractors are generated via LLM at build time and stored statically.
    """

    def __init__(self, llm_generator=None):
        self.llm = llm_generator  # optional, for distractor generation

    def generate_for_node(self, node_id: int, db) -> list[dict]:
        """Generate all puzzle types for a node."""
        node = db.get_node_by_id(node_id)
        edges = db.get_edges_by_parent(node_id)
        reasoning = db.get_reasoning_by_node(node_id)

        if not edges:
            return []

        puzzles = []

        # Tier 1 — Basic recognition
        puzzles.append(self._best_move_puzzle(node, edges))

        # Tier 2 — Understanding why
        puzzles.append(self._why_this_move_puzzle(node, edges, reasoning))

        # Tier 3 — Anti-move awareness
        anti_edges = [e for e in edges if e["is_anti_move"]]
        if anti_edges:
            puzzles.append(self._why_not_puzzle(node, anti_edges, reasoning))

        # Tier 4 — Strategic thinking
        puzzles.append(self._game_plan_puzzle(node, reasoning))
        puzzles.append(self._consequence_puzzle(node, edges, reasoning))

        # Tier 5 — Advanced
        puzzles.append(self._predict_opponent_puzzle(node, edges, reasoning))
        trap_edges = [e for e in edges if e["is_anti_move"] and e["frequency"] > 0.05]
        if trap_edges:
            puzzles.append(self._trap_recognition_puzzle(node, trap_edges, reasoning))

        return [p for p in puzzles if p is not None]

    def _best_move_puzzle(self, node, edges) -> dict:
        main_line = max(edges, key=lambda e: e["frequency"])
        wrong_options = [
            {
                "move": e["move_san"],
                "reasoning_why_wrong": f"Played only {e['frequency']*100:.0f}% of the time at this level"
            }
            for e in sorted(edges, key=lambda e: e["frequency"], reverse=True)[1:4]
        ]
        return {
            "node_id": node["id"],
            "puzzle_type": "best_move",
            "difficulty_tier": 1,
            "question": "What is the best move in this position?",
            "correct_answer": main_line["move_uci"],
            "correct_reasoning": "This is the most common and strongest move.",
            "wrong_options": wrong_options
        }

    def _why_this_move_puzzle(self, node, edges, reasoning) -> dict | None:
        main_edge = max(edges, key=lambda e: e["frequency"])
        r = reasoning.get(main_edge["id"])
        if not r:
            return None

        wrong_options = self._generate_distractors(r, "why_this_move")

        return {
            "node_id": node["id"],
            "puzzle_type": "why_this_move",
            "difficulty_tier": 2,
            "question": f"Why is {main_edge['move_san']} the right move here?",
            "correct_answer": r["why_play"],
            "correct_reasoning": r["why_play"],
            "wrong_options": wrong_options
        }

    def _why_not_puzzle(self, node, anti_edges, reasoning) -> dict | None:
        edge = anti_edges[0]
        r = reasoning.get(edge["id"])
        if not r or not r.get("why_not"):
            return None
        return {
            "node_id": node["id"],
            "puzzle_type": "why_not_move",
            "difficulty_tier": 3,
            "question": f"Why should you avoid {edge['move_san']} in this position?",
            "correct_answer": r["why_not"],
            "correct_reasoning": r["why_not"],
            "wrong_options": self._generate_distractors(r, "why_not")
        }

    def _game_plan_puzzle(self, node, reasoning) -> dict | None:
        # Use reasoning from the main line edge
        if not reasoning:
            return None
        r = next(iter(reasoning.values()))
        if not r.get("game_plan"):
            return None
        return {
            "node_id": node["id"],
            "puzzle_type": "game_plan",
            "difficulty_tier": 4,
            "question": "What is the strategic plan from this position?",
            "correct_answer": r["game_plan"],
            "correct_reasoning": r["game_plan"],
            "wrong_options": self._generate_distractors(r, "game_plan")
        }

    def _consequence_puzzle(self, node, edges, reasoning) -> dict | None:
        anti = [e for e in edges if e["is_anti_move"]]
        if not anti or not reasoning:
            return None
        edge = anti[0]
        r = reasoning.get(edge["id"])
        if not r or not r.get("why_not"):
            return None
        return {
            "node_id": node["id"],
            "puzzle_type": "consequence",
            "difficulty_tier": 4,
            "question": f"What happens if you play {edge['move_san']}?",
            "correct_answer": r["why_not"],
            "correct_reasoning": r["why_not"],
            "wrong_options": self._generate_distractors(r, "consequence")
        }

    def _predict_opponent_puzzle(self, node, edges, reasoning) -> dict | None:
        if not reasoning:
            return None
        main_edge = max(edges, key=lambda e: e["frequency"])
        r = reasoning.get(main_edge["id"])
        if not r or not r.get("what_opponent_wants"):
            return None
        return {
            "node_id": node["id"],
            "puzzle_type": "predict_opponent",
            "difficulty_tier": 5,
            "question": "What is your opponent's main plan in this position?",
            "correct_answer": r["what_opponent_wants"],
            "correct_reasoning": r["what_opponent_wants"],
            "wrong_options": self._generate_distractors(r, "predict_opponent")
        }

    def _trap_recognition_puzzle(self, node, trap_edges, reasoning) -> dict | None:
        edge = trap_edges[0]
        r = reasoning.get(edge["id"])
        if not r:
            return None
        return {
            "node_id": node["id"],
            "puzzle_type": "trap_recognition",
            "difficulty_tier": 5,
            "question": f"{edge['move_san']} is a popular move here ({edge['frequency']*100:.0f}% of games). Is it a trap?",
            "correct_answer": r.get("why_not", "Yes, this is a trap."),
            "correct_reasoning": r.get("why_not", ""),
            "wrong_options": self._generate_distractors(r, "trap")
        }

    def _generate_distractors(self, reasoning: dict, puzzle_type: str) -> list[dict]:
        """
        Generate plausible wrong options.

        Strategy:
        1. Try LLM-generated distractors (build-time, stored statically)
        2. Fall back to heuristic distractors from the reasoning data
        """
        if self.llm:
            try:
                return self._llm_distractors(reasoning, puzzle_type)
            except Exception:
                log.warning("distractor_llm_failed", puzzle_type=puzzle_type)

        # Heuristic fallback: construct plausible-sounding wrong answers
        # from fragments of other reasoning fields
        distractors = []
        fields = ["why_play", "why_not", "what_opponent_wants", "game_plan"]
        used_field = {
            "why_this_move": "why_play",
            "why_not": "why_not",
            "game_plan": "game_plan",
            "predict_opponent": "what_opponent_wants",
            "consequence": "why_not",
            "trap": "why_not",
        }.get(puzzle_type, "why_play")

        for field in fields:
            if field != used_field and reasoning.get(field):
                distractors.append({
                    "text": reasoning[field],
                    "reasoning_why_wrong": "This describes a different aspect of the position."
                })

        return distractors[:3]

    def _llm_distractors(self, reasoning: dict, puzzle_type: str) -> list[dict]:
        """Generate 3 plausible but wrong explanations via LLM."""
        prompt = f"""
Given this correct chess explanation:
"{reasoning.get('why_play', reasoning.get('game_plan', ''))}"

Generate exactly 3 plausible but WRONG explanations for a chess puzzle.
Each should sound reasonable but contain a factual or strategic error.
Return JSON array: [{{"text": "...", "reasoning_why_wrong": "..."}}]
Return ONLY the JSON array.
"""
        raw = self.llm._call_llm(prompt)
        import json
        text = raw.strip()
        if text.startswith("```"):
            text = text.split("\n", 1)[1]
            if text.endswith("```"):
                text = text[:-3]
        return json.loads(text.strip())
```

### 4.5 Pipeline Orchestrator

Each pipeline stage can be run independently. The `pipeline_progress` table
acts as the checkpoint store so any stage can be resumed after failure.

```python
# pipeline/orchestrator.py

import structlog

log = structlog.get_logger()

class PipelineOrchestrator:
    """
    Runs pipeline stages in order, skipping already-completed work.
    Each stage is idempotent and can be re-run safely.
    """

    def __init__(self, db, config: dict):
        self.db = db
        self.config = config

    def run_all(self):
        """Run the full pipeline end-to-end."""
        stages = [
            ("pgn_parse", self._run_pgn_parse),
            ("dag_build", self._run_dag_build),
            ("stockfish", self._run_stockfish),
            ("eco_map", self._run_eco_map),
            ("llm_reasoning", self._run_llm_reasoning),
            ("puzzles", self._run_puzzles),
        ]

        for name, fn in stages:
            remaining = self.db.count_pending(name)
            if remaining == 0:
                log.info("stage_skipped", stage=name, reason="all_complete")
                continue
            log.info("stage_starting", stage=name, remaining=remaining)
            fn()
            log.info("stage_done", stage=name)

    def _run_pgn_parse(self):
        from pipeline.pgn_parser import parse_pgn
        from pipeline.aggregator import StreamingAggregator
        agg = StreamingAggregator(self.db, max_positions=self.config.get("max_positions", 100_000))
        for record in parse_pgn(
            self.config["pgn_path"],
            min_rating=self.config.get("min_rating", 1000),
            max_rating=self.config.get("max_rating", 1600),
        ):
            agg.add(record)
        agg.build_dag(threshold=self.config.get("threshold", 0.10))

    def _run_dag_build(self):
        # Transposition detection, depth assignment
        pass

    def _run_stockfish(self):
        from pipeline.engine_tagger import AntiMoveTagger
        tagger = AntiMoveTagger(
            stockfish_path=self.config["stockfish_path"],
            depth=self.config.get("stockfish_depth", 18),
        )
        tagger.tag_all_edges(
            self.db,
            batch_size=self.config.get("stockfish_batch", 100),
            workers=self.config.get("stockfish_workers", 4),
        )

    def _run_eco_map(self):
        pass

    def _run_llm_reasoning(self):
        from pipeline.study_plan_generator import StudyPlanGenerator
        gen = StudyPlanGenerator(api_key=self.config["anthropic_api_key"])
        gen.generate_all(self.db, depth_first=True)

    def _run_puzzles(self):
        from pipeline.puzzle_generator import PuzzleGenerator
        gen = PuzzleGenerator()
        nodes = self.db.get_nodes_without_puzzles()
        for node_id in nodes:
            puzzles = gen.generate_for_node(node_id, self.db)
            self.db.save_puzzles(puzzles)
            self.db.mark_pipeline_complete("puzzles", node_id=node_id)
```

---

## 5. Development Phases

### Phase 1 — DAG Builder (Weeks 1–5)

**Goal:** Working DAG in PostgreSQL from Lichess PGN data.

Tasks:
- Set up PostgreSQL schema (all tables, indexes, staging tables)
- Build PGN parser with rating + time control filtering
- Build streaming aggregator with bounded memory and UPSERT
- Implement FEN normalization and transposition detection (top-5 paths)
- Integrate Stockfish with parallel worker pool + checkpointing
- Load ECO code database and map to FENs
- Write DAG verification script
- Set up structlog for pipeline observability

Deliverable: Populated PostgreSQL database with ~50k–200k nodes, all edges tagged.

Validation metrics:
- Starting position has correct children (e4, d4, Nf3, c4 as top moves)
- Scandinavian after 1.e4 d5 2.exd5 has Qxd5 and Nf6 as children
- No duplicate FENs in nodes table
- All anti-moves have eval_drop > 50 centipawns
- Memory usage stays under 2GB during aggregation

---

### Phase 2 — Study Plan Generator (Weeks 6–9)

**Goal:** Pre-generated reasoning stored for all edges.

Tasks:
- Build LLM prompt pipeline with full position context
- Implement retry with exponential backoff (tenacity)
- Implement JSON response validation
- Implement checkpointing via pipeline_progress table
- Build prompt versioning (track model + prompt version per reasoning)
- Add regeneration support for specific nodes
- Process depth-first (shallower = higher priority)
- Implement cost tracking and progress logging

LLM Cost Estimate:
- ~200k edges × ~400 input tokens = ~80M input tokens → ~$240 (Sonnet)
- ~200k edges × ~500 output tokens = ~100M output tokens → ~$1,500 (Sonnet)
- **Total: ~$1,740 per full build**
- Mitigation: process by depth, stop at depth 15 initially (~60k edges, ~$520)

Deliverable: All edges have reasoning content. Pipeline is resumable after failures.

---

### Phase 3 — Puzzle Engine (Weeks 10–12)

**Goal:** All puzzle types generated and stored for every node.

Tasks:
- Implement all 8 puzzle type generators
- Build distractor generator (LLM with heuristic fallback)
- Implement difficulty tier assignment
- Assign puzzles to nodes in DB
- Write puzzle validation script (all nodes have tier 1–3 minimum)

Deliverable: Puzzles table populated, minimum 4 puzzles per node.

---

## 6. Future Work

These are designed but not yet implemented. They will begin after Phase 3 is validated.

| Phase | What | When |
|---|---|---|
| Phase 4 | SRS Engine — SM-2 with node-level ripple propagation | After Phase 3 |
| Phase 5 | REST API — FastAPI with all DAG/Study/Puzzle/SRS endpoints | After Phase 4 |
| Phase 6 | React Frontend — DAG explorer, lesson view, puzzle UI, dashboard | After Phase 5 |
| Phase 7 | Update Pipeline — Diff new PGN data, patch DAG, regenerate | After Phase 6 |

### Periodic Update Strategy (future)

| Change Type | Action |
|---|---|
| New position crosses 10% threshold | Add node + edge, generate reasoning, generate puzzles |
| Existing position's frequency changes | Update stats, re-evaluate anti-move flags |
| Position drops below 10% threshold | Archive node (preserve user SRS data), remove from active DAG |
| New anti-move detected | Update edge flag, update puzzles, reschedule active learners |
| Opening name changes (ECO update) | Update name field only |

- **Full rebuild:** Every 6 months
- **Stats refresh:** Monthly
- **Anti-move re-check:** Quarterly

---

## 7. Open Questions and Decisions

| Question | Options | Recommendation |
|---|---|---|
| FEN normalization depth | Strip move counters only vs. also strip castling rights | Strip move counters only; castling rights affect legality |
| 10% threshold — fixed or adaptive? | Fixed 10% vs. higher at shallow depths | Start fixed; adaptive can be Phase 7+ |
| Transposition handling in study plan | Show transposition notice vs. transparent | Show — it's a teaching moment |
| Anti-move threshold | 50 vs. 30 vs. 100 centipawns | 50 cp; tune after Phase 1 |
| LLM reasoning — when to regenerate | Never vs. on model upgrade vs. on stats change | On major model upgrades only |
| Puzzle distractors | Static heuristics vs. LLM-generated | LLM at build time with heuristic fallback |
| Multi-user from day one | Single-user vs. multi-user schema | Multi-user schema from day one |
| Mobile support | Responsive web vs. native app | Responsive web first |
| Offline support | Online-only vs. cached offline | Cache today's session (PWA), Phase 7+ |
| LLM depth cutoff | All nodes vs. depth ≤ 15 initially | Depth ≤ 15 for first build to control cost |

---

*Document version 2.1 — February 2026*
*Scope: Build-time pipeline (DAG + Lessons + Puzzles)*
*Next review: After Phase 1 completion*
