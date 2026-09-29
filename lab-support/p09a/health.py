"""Health checks expose no database credentials or experiment evidence."""
import sys
from core import Settings, Store
settings = Settings.environment()
health = Store(settings.state_dir).health()
ready = health['guardianReady'] and (sys.argv[1] == 'guardian' or health['workerReady'])
raise SystemExit(0 if ready else 1)
