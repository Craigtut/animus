-- Fix plugins installed from .anpk that were incorrectly marked as 'store'
-- The 'store' source should only be used for future Animus Store downloads
UPDATE plugins SET source = 'package'
  WHERE source = 'store'
    AND installed_from = 'package';
