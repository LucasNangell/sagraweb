
from database import db
import json
import logging

# Configure basic logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

def fix_model_keys():
    try:
        # Fetch all active models with configuration
        query = "SELECT NomeProduto, ConfigCampos FROM tabPapelariaModelos WHERE Ativo = 1"
        results = db.execute_query(query)
        
        logger.info(f"Scanning {len(results)} models for key mismatches...")
        
        updated_count = 0
        
        for row in results:
            nome_produto = row['NomeProduto']
            config_str = row['ConfigCampos']
            
            if not config_str:
                continue
                
            try:
                config = json.loads(config_str)
            except json.JSONDecodeError:
                logger.warning(f"Invalid JSON for {nome_produto}")
                continue
                
            if not isinstance(config, list):
                continue
                
            changed = False
            for field in config:
                # The core logic: ensure 'key' equals 'shape'
                if field.get('shape') and field.get('key') != field.get('shape'):
                    old_key = field.get('key')
                    new_key = field.get('shape')
                    field['key'] = new_key
                    logger.info(f"[{nome_produto}] Updating key: '{old_key}' -> '{new_key}'")
                    changed = True
            
            if changed:
                new_config_str = json.dumps(config)
                update_query = "UPDATE tabPapelariaModelos SET ConfigCampos = %s WHERE NomeProduto = %s"
                db.execute_query(update_query, (new_config_str, nome_produto))
                updated_count += 1
                
        logger.info(f"Start Update Process Completed. Total models updated: {updated_count}")
        
    except Exception as e:
        logger.error(f"Critical Error: {e}")

if __name__ == "__main__":
    fix_model_keys()
