import os
import duckdb

DB_PATH = "/mnt/chess_evals/chess_evals.duckdb"
PARQUET_DIR = "/mnt/hf_cache/hub/datasets--Lichess--chess-position-evaluations/snapshots/3135c379f8d7e81c4fad71a2be6f5778039cc0a1/data"
PARQUET_GLOB = os.path.join(PARQUET_DIR, "*.parquet")

os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)

con = duckdb.connect(DB_PATH)

# Create table from remote parquet files on first run
tables = con.execute("SHOW TABLES").fetchall()
if not any(t[0] == "evaluations" for t in tables):
    print("First run: importing dataset into DuckDB (this may take a while)...")
    con.execute(f"""
        CREATE TABLE evaluations AS
        SELECT * FROM read_parquet('{PARQUET_GLOB}')
    """)
    print("Creating index on FEN column...")
    con.execute("CREATE INDEX idx_fen ON evaluations (fen)")
    print("Import complete!\n")

print("Ready. Enter a FEN to search, or type 'exit' to quit.\n")

while True:
    query = input("FEN> ").strip()
    if query.lower() == "exit":
        print("Goodbye!")
        break
    if not query:
        continue

    results = con.execute(
        "SELECT * FROM evaluations WHERE fen = ?", [query]
    ).fetchall()

    if results:
        columns = ["fen", "line", "depth", "knodes", "cp", "mate"]
        print(f"\nFound {len(results)} result(s):\n")
        for i, row in enumerate(results, 1):
            for col, val in zip(columns, row):
                print(f"  {col:>8}: {val}")
            print()
    else:
        print(f"\nNo results found for FEN: {query}\n")

con.close()
