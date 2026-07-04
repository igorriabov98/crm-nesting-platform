INSERT INTO public.steel_types (name, density_kg_mm3) VALUES
  ('Ст3сп', 0.00000785),
  ('Ст3пс', 0.00000785),
  ('09Г2С', 0.00000785),
  ('10', 0.00000785),
  ('20', 0.00000785),
  ('45', 0.00000785),
  ('40Х', 0.00000785),
  ('65Г', 0.00000785),
  ('12Х18Н10Т', 0.00000790),
  ('AISI 304', 0.00000793),
  ('AISI 430', 0.00000770)
ON CONFLICT (name) DO UPDATE
SET density_kg_mm3 = EXCLUDED.density_kg_mm3;
