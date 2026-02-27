import sqlite3
import os

DB_PATH = "chat.db"

def init_db():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    # Settings table for shared password
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT
    )
    ''')
    
    # Default shared password if not exists
    cursor.execute("INSERT OR IGNORE INTO settings (key, value) VALUES ('admin_password', 'LET_GROW')")
    
    # Admin Status table
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS admin_status (
        slot INTEGER PRIMARY KEY,
        is_available BOOLEAN DEFAULT 0
    )
    ''')
    
    # Initialize 3 admin slots
    for i in range(1, 4):
        cursor.execute("INSERT OR IGNORE INTO admin_status (slot, is_available) VALUES (?, 0)", (i,))
        
    # Links table
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS links (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        url TEXT NOT NULL,
        description TEXT
    )
    ''')
    
    # Announcements table
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS announcements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        content TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
    ''')
    
    conn.commit()
    conn.close()

def get_db_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

if __name__ == "__main__":
    init_db()
    print("Database initialized.")
