import json
import os
import logging

# Default Configuration matches the hardcoded values previously in database.py
DEFAULT_CONFIG = {
    "db_host": "10.120.1.125",
    "db_port": 3306,
    "db_user": "root",
    "db_password": "",
    "db_name": "sagrafulldb",
    "server_port": 8001
}

CONFIG_FILE = "config.json"

class ConfigManager:
    _instance = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(ConfigManager, cls).__new__(cls)
            cls._instance.config = DEFAULT_CONFIG.copy()
            cls._instance.load_config()
        return cls._instance

    def load_config(self):
        """Loads configuration from file or creates it if missing."""
        if os.path.exists(CONFIG_FILE):
            try:
                with open(CONFIG_FILE, 'r', encoding='utf-8') as f:
                    loaded_config = json.load(f)
                    # Merge with default to ensure all keys exist
                    self.config.update(loaded_config)
            except Exception as e:
                logging.error(f"Error loading config: {e}")
        else:
            self.save_config() # Create default file

    def save_config(self, new_config=None):
        """Saves current configuration to file."""
        if new_config:
            self.config.update(new_config)
            
        try:
            with open(CONFIG_FILE, 'w', encoding='utf-8') as f:
                json.dump(self.config, f, indent=4)
        except Exception as e:
            logging.error(f"Error saving config: {e}")

    def get(self, key, default=None):
        return self.config.get(key, default)

    def set(self, key, value):
        self.config[key] = value

# Singleton instance
config_manager = ConfigManager()
