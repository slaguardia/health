-- A link for each supplement, and what the practitioner's plan recommended when
-- Steven takes a different product in its place.
ALTER TABLE supplements ADD COLUMN url TEXT;           -- the product page of what he takes
ALTER TABLE supplements ADD COLUMN plan_product TEXT;  -- the plan's pick, when he takes another: 'O.N.E. Multivitamin (Pure Encapsulations)'
ALTER TABLE supplements ADD COLUMN plan_url TEXT;      -- the plan's product page
