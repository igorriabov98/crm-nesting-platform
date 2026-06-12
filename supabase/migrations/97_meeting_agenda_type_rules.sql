UPDATE meeting_types
SET
  label = 'Совещание с производством Берегово',
  color = 'green',
  is_system = true,
  is_active = true,
  updated_at = now()
WHERE key = 'factory_bergovo';

UPDATE meeting_types
SET
  label = 'Совещание с производством Ужгород',
  color = 'orange',
  is_system = true,
  is_active = true,
  updated_at = now()
WHERE key = 'factory_uzhgorod';

INSERT INTO meeting_types (key, label, color, is_system, is_active)
VALUES ('tech_engineer_supply', 'Технолог+Инженер+Снабжение', 'purple', true, true)
ON CONFLICT (key) DO UPDATE
SET
  label = EXCLUDED.label,
  color = EXCLUDED.color,
  is_system = true,
  is_active = true,
  updated_at = now();
