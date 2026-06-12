# Ð¡Ñ…ÐµÐ¼Ð° Ð±Ð°Ð·Ñ‹ Ð´Ð°Ð½Ð½Ñ‹Ñ… (Supabase PostgreSQL)

## Ð¢Ð°Ð±Ð»Ð¸Ñ†Ð°: factories
| ÐŸÐ¾Ð»Ðµ | Ð¢Ð¸Ð¿ | ÐžÐ¿Ð¸ÑÐ°Ð½Ð¸Ðµ |
|------|-----|----------|
| id | uuid PK | |
| name | text NOT NULL | "Ð‘ÐµÑ€Ð³Ð¾Ð²Ð¾" Ð¸Ð»Ð¸ "Ð£Ð¶Ð³Ð¾Ñ€Ð¾Ð´" |
| created_at | timestamptz | default now() |

## Ð¢Ð°Ð±Ð»Ð¸Ñ†Ð°: users
| ÐŸÐ¾Ð»Ðµ | Ð¢Ð¸Ð¿ | ÐžÐ¿Ð¸ÑÐ°Ð½Ð¸Ðµ |
|------|-----|----------|
| id | uuid PK | ÑÐ²ÑÐ·ÑŒ Ñ auth.users |
| email | text UNIQUE NOT NULL | |
| full_name | text NOT NULL | |
| role | enum NOT NULL | ÑÐ¼. Ð½Ð¸Ð¶Ðµ |
| factory_id | uuid FK â†’ factories | |
| is_active | boolean | default true |
| created_at | timestamptz | default now() |
| created_by | uuid FK â†’ users | ÐºÑ‚Ð¾ ÑÐ¾Ð·Ð´Ð°Ð» |

### Enum: user_role
- financial_director (Ð¤Ð¸Ð½Ð°Ð½ÑÐ¾Ð²Ñ‹Ð¹ Ð´Ð¸Ñ€ÐµÐºÑ‚Ð¾Ñ€)
- commercial_director (ÐšÐ¾Ð¼Ð¼ÐµÑ€Ñ‡ÐµÑÐºÐ¸Ð¹ Ð´Ð¸Ñ€ÐµÐºÑ‚Ð¾Ñ€)
- planning_director (Ð”Ð¸Ñ€ÐµÐºÑ‚Ð¾Ñ€ Ð¿Ð»Ð°Ð½Ð¸Ñ€Ð¾Ð²Ð°Ð½Ð¸Ñ)
- sales_manager (Sales Ð¼ÐµÐ½ÐµÐ´Ð¶ÐµÑ€)
- engineer (Ð˜Ð½Ð¶ÐµÐ½ÐµÑ€)
- technologist (Ð¢ÐµÑ…Ð½Ð¾Ð»Ð¾Ð³)
- supply_manager (Ð¡Ð½Ð°Ð±Ð¶ÐµÐ½Ð¸Ðµ)
- production_manager (ÐÐ°Ñ‡Ð°Ð»ÑŒÐ½Ð¸Ðº Ð¿Ñ€Ð¾Ð¸Ð·Ð²Ð¾Ð´ÑÑ‚Ð²Ð°)

## Ð¢Ð°Ð±Ð»Ð¸Ñ†Ð°: machines (Sales Plan)
| ÐŸÐ¾Ð»Ðµ | Ð¢Ð¸Ð¿ | ÐžÐ¿Ð¸ÑÐ°Ð½Ð¸Ðµ |
|------|-----|----------|
| id | uuid PK | |
| factory_id | uuid FK â†’ factories | NULLABLE (Ð½Ð°Ð·Ð½Ð°Ñ‡Ð°ÐµÑ‚ÑÑ Ð½Ð° ÑÐ¾Ð±Ñ€Ð°Ð½Ð¸Ð¸) |
| name | text NOT NULL | ÐÐ°Ð·Ð²Ð°Ð½Ð¸Ðµ Ð¼Ð°ÑˆÐ¸Ð½Ñ‹ |
| status | enum NOT NULL | Ð¢ÐµÐºÑƒÑ‰Ð¸Ð¹ ÑÑ‚Ð°Ñ‚ÑƒÑ (created, in_production, Ð¸ Ñ‚Ð´) |
| material_type | enum NOT NULL | Ð¢Ð¸Ð¿ Ð¼Ð°Ñ‚ÐµÑ€Ð¸Ð°Ð»Ð° |
| desired_shipping_date | date | Ð–ÐµÐ»Ð°ÐµÐ¼Ð°Ñ ÐºÐ»Ð¸ÐµÐ½Ñ‚Ð¾Ð¼ Ð´Ð°Ñ‚Ð° Ð¾Ñ‚Ð³Ñ€ÑƒÐ·ÐºÐ¸ |
| created_by | uuid FK â†’ users | Sales Ð¼ÐµÐ½ÐµÐ´Ð¶ÐµÑ€ |
| created_at | timestamptz | default now() |

### Enum: machine_status
- created (Ð¡Ð¾Ð·Ð´Ð°Ð½Ð°)
- under_review (ÐÐ° Ñ€Ð°ÑÑÐ¼Ð¾Ñ‚Ñ€ÐµÐ½Ð¸Ð¸/Ð¡Ð¾Ð±Ñ€Ð°Ð½Ð¸Ðµ)
- factory_assigned (Ð—Ð°Ð²Ð¾Ð´ Ð½Ð°Ð·Ð½Ð°Ñ‡ÐµÐ½)
- in_production (Ð’ Ð¿Ñ€Ð¾Ð¸Ð·Ð²Ð¾Ð´ÑÑ‚Ð²Ðµ)
- shipped (ÐžÑ‚Ð³Ñ€ÑƒÐ¶ÐµÐ½Ð°)

### Enum: material_type
- standard (Ð¡Ñ‚Ð°Ð½Ð´Ð°Ñ€Ñ‚Ð½Ñ‹Ð¹)
- non_standard (ÐÐµÑÑ‚Ð°Ð½Ð´Ð°Ñ€Ñ‚Ð½Ñ‹Ð¹)
- undefined (ÐÐµ Ð¾Ð¿Ñ€ÐµÐ´ÐµÐ»Ñ‘Ð½)

## Ð¢Ð°Ð±Ð»Ð¸Ñ†Ð°: machine_items
| ÐŸÐ¾Ð»Ðµ | Ð¢Ð¸Ð¿ | ÐžÐ¿Ð¸ÑÐ°Ð½Ð¸Ðµ |
|------|-----|----------|
| id | uuid PK | |
| machine_id | uuid FK â†’ machines NOT NULL | CASCADE DELETE |
| drawing_number | text NOT NULL | ÐÐ¾Ð¼ÐµÑ€ Ñ‡ÐµÑ€Ñ‚ÐµÐ¶Ð° |
| product_name | text NOT NULL | ÐÐ°Ð·Ð²Ð°Ð½Ð¸Ðµ Ñ‚Ð¾Ð²Ð°Ñ€Ð° |
| weight | decimal NOT NULL | Ð’ÐµÑ ÐµÐ´Ð¸Ð½Ð¸Ñ†Ñ‹ (Ñ‚Ð¾Ð½Ð½Ñ‹) |
| price | decimal NOT NULL | Ð¦ÐµÐ½Ð° Ð·Ð° ÐµÐ´Ð¸Ð½Ð¸Ñ†Ñƒ |
| quantity | integer NOT NULL | ÐšÐ¾Ð»Ð¸Ñ‡ÐµÑÑ‚Ð²Ð¾ |
| coating | enum NOT NULL | Ð¢Ð¸Ð¿ Ð¿Ð¾ÐºÑ€Ñ‹Ñ‚Ð¸Ñ |
| ral_number | text | ÐÐ¾Ð¼ÐµÑ€ RAL (ÐµÑÐ»Ð¸ Ð¿Ð¾Ñ€Ð¾ÑˆÐºÐ¾Ð²Ð°Ñ) |
| is_sample | boolean NOT NULL | true Ð´Ð»Ñ Ð¾Ð±Ñ€Ð°Ð·Ñ†Ð¾Ð², false Ð´Ð»Ñ Ð¾Ð±Ñ‹Ñ‡Ð½Ñ‹Ñ… Ñ‚Ð¾Ð²Ð°Ñ€Ð¾Ð² |
| sort_order | integer NOT NULL | ÐŸÐ¾Ñ€ÑÐ´Ð¾Ðº ÑÐ¾Ñ€Ñ‚Ð¸Ñ€Ð¾Ð²ÐºÐ¸ |
| created_at | timestamptz | default now() |

### Enum: coating_type
- zinc (Ð¦Ð¸Ð½Ðº)
- powder_coating (ÐŸÐ¾Ñ€Ð¾ÑˆÐºÐ¾Ð²Ð°Ñ Ð¿Ð¾ÐºÑ€Ð°ÑÐºÐ°)
- none (Ð‘ÐµÐ· Ð¿Ð¾ÐºÑ€Ñ‹Ñ‚Ð¸Ñ)

## Ð¢Ð°Ð±Ð»Ð¸Ñ†Ð°: machine_expenses
| ÐŸÐ¾Ð»Ðµ | Ð¢Ð¸Ð¿ | ÐžÐ¿Ð¸ÑÐ°Ð½Ð¸Ðµ |
|------|-----|----------|
| id | uuid PK | |
| machine_id | uuid FK â†’ machines NOT NULL | CASCADE DELETE |
| category | text NOT NULL | ÐšÐ°Ñ‚ÐµÐ³Ð¾Ñ€Ð¸Ñ (Ð¢Ñ€Ð°Ð½ÑÐ¿Ð¾Ñ€Ñ‚, ÐœÐ¾Ð½Ñ‚Ð°Ð¶ Ð¸ Ñ‚.Ð´.) |
| amount | decimal NOT NULL | Ð¡ÑƒÐ¼Ð¼Ð° Ñ€Ð°ÑÑ…Ð¾Ð´Ð° |
| comment | text | ÐšÐ¾Ð¼Ð¼ÐµÐ½Ñ‚Ð°Ñ€Ð¸Ð¹ |
| created_at | timestamptz | default now() |

## View: machines_with_totals
(Computed view, Ð¾Ð±ÑŠÐµÐ´Ð¸Ð½ÑÑŽÑ‰ÐµÐµ `machines`, `machine_items` Ð¸ `machine_expenses`)
| ÐŸÐ¾Ð»Ðµ | ÐžÐ¿Ð¸ÑÐ°Ð½Ð¸Ðµ |
|------|----------|
| m.* | Ð’ÑÐµ Ð¿Ð¾Ð»Ñ Ð¼Ð°ÑˆÐ¸Ð½Ñ‹ |
| total_weight | Ð¡ÑƒÐ¼Ð¼Ð°Ñ€Ð½Ñ‹Ð¹ Ð²ÐµÑ Ð²ÑÐµÑ… Ñ‚Ð¾Ð²Ð°Ñ€Ð¾Ð² (weight * qty) |
| total_items_cost | Ð¡ÑƒÐ¼Ð¼Ð°Ñ€Ð½Ð°Ñ ÑÑ‚Ð¾Ð¸Ð¼Ð¾ÑÑ‚ÑŒ Ñ‚Ð¾Ð²Ð°Ñ€Ð¾Ð² (price * qty) |
| total_expenses | Ð¡ÑƒÐ¼Ð¼Ð°Ñ€Ð½Ð°Ñ ÑÑ‚Ð¾Ð¸Ð¼Ð¾ÑÑ‚ÑŒ Ð´Ð¾Ð¿. Ñ€Ð°ÑÑ…Ð¾Ð´Ð¾Ð² |
| total_cost | items_cost + expenses |
| item_count | ÐšÐ¾Ð»Ð¸Ñ‡ÐµÑÑ‚Ð²Ð¾ Ð¿Ð¾Ð·Ð¸Ñ†Ð¸Ð¹ (ÑÑ‚Ñ€Ð¾Ðº) Ñ‚Ð¾Ð²Ð°Ñ€Ð¾Ð² |
| has_zinc | ÐŸÑ€Ð¸ÑÑƒÑ‚ÑÑ‚Ð²ÑƒÐµÑ‚ Ð»Ð¸ Ñ†Ð¸Ð½Ðº |
| has_painting| ÐŸÑ€Ð¸ÑÑƒÑ‚ÑÑ‚Ð²ÑƒÐµÑ‚ Ð»Ð¸ Ð¼Ð°Ð»ÑÑ€ÐºÐ° |

## Ð¢Ð°Ð±Ð»Ð¸Ñ†Ð°: production_stages
| ÐŸÐ¾Ð»Ðµ | Ð¢Ð¸Ð¿ | ÐžÐ¿Ð¸ÑÐ°Ð½Ð¸Ðµ |
|------|-----|----------|
| id | uuid PK | |
| machine_id | uuid FK â†’ machines NOT NULL | CASCADE DELETE |
| stage_type | enum NOT NULL | Ð¢Ð¸Ð¿ ÑÑ‚Ð°Ð¿Ð° |
| workshop | smallint | 1 Ð¸Ð»Ð¸ 2 |
| date_start | date | |
| date_end | date | |
| is_skipped | boolean | default false |
| is_night_shift | boolean | default false |
| night_shift_date | date | ÐºÐ¾Ð½ÐºÑ€ÐµÑ‚Ð½Ð°Ñ Ð´Ð°Ñ‚Ð° Ð½Ð¾Ñ‡Ð½Ð¾Ð¹ ÑÐ¼ÐµÐ½Ñ‹ |
| created_at | timestamptz | default now() |
| updated_by | uuid FK â†’ users | |

### Enum: stage_type
- cutting (Ð—Ð°Ð³Ð¾Ñ‚Ð¾Ð²ÐºÐ°) â€” Ð²ÑÐµÐ³Ð´Ð° Ð¦ÐµÑ… 1
- assembly (Ð¡Ð±Ð¾Ñ€ÐºÐ°) â€” Ð²Ñ‹Ð±Ð¾Ñ€ Ð¦ÐµÑ… 1 Ð¸Ð»Ð¸ 2
- cleaning (Ð—Ð°Ñ‡Ð¸ÑÑ‚ÐºÐ°) â€” Ð²Ñ‹Ð±Ð¾Ñ€ Ð¦ÐµÑ… 1 Ð¸Ð»Ð¸ 2
- galvanizing (Ð¦Ð¸Ð½Ðº) â€” Ð²Ñ‹Ð±Ð¾Ñ€ Ð¦ÐµÑ… 1 Ð¸Ð»Ð¸ 2
- painting (ÐœÐ°Ð»ÑÑ€ÐºÐ°) â€” Ð²ÑÐµÐ³Ð´Ð° Ð¦ÐµÑ… 2
- packaging (Ð£Ð¿Ð°ÐºÐ¾Ð²ÐºÐ°) â€” Ð²ÑÐµÐ³Ð´Ð° Ð¦ÐµÑ… 2
- shipping (ÐžÑ‚Ð³Ñ€ÑƒÐ·ÐºÐ°) â€” Ð±ÐµÐ· Ñ†ÐµÑ…Ð°

## Ð¢Ð°Ð±Ð»Ð¸Ñ†Ð°: supply_items
| ÐŸÐ¾Ð»Ðµ | Ð¢Ð¸Ð¿ | ÐžÐ¿Ð¸ÑÐ°Ð½Ð¸Ðµ |
|------|-----|----------|
| id | uuid PK | |
| machine_id | uuid FK â†’ machines NOT NULL | CASCADE DELETE |
| engineer_confirmation | boolean | default false |
| engineer_confirmed_at | timestamptz | |
| engineer_deadline | date | ÐÐ’Ð¢Ðž: technologist_deadline - 2 Ð´Ð½Ñ |
| nomenclature | text | Ð—Ð°Ð¿Ð¾Ð»Ð½ÑÐµÑ‚ Ñ‚ÐµÑ…Ð½Ð¾Ð»Ð¾Ð³ |
| unit | text | Ð•Ð´Ð¸Ð½Ð¸Ñ†Ð° Ð¸Ð·Ð¼ÐµÑ€ÐµÐ½Ð¸Ñ |
| quantity | decimal | ÐšÐ¾Ð»Ð¸Ñ‡ÐµÑÑ‚Ð²Ð¾ |
| technologist_deadline | date | ÐÐ’Ð¢Ðž: planned_delivery_date - 10 Ð´Ð½ÐµÐ¹ |
| supplier | text | Ð—Ð°Ð¿Ð¾Ð»Ð½ÑÐµÑ‚ ÑÐ½Ð°Ð±Ð¶ÐµÐ½Ð¸Ðµ |
| price_per_unit | decimal | |
| status | enum | default 'not_ordered' |
| comment | text | ÐšÐ¾Ð¼Ð¼ÐµÐ½Ñ‚Ð°Ñ€Ð¸Ð¹ ÑÐ½Ð°Ð±Ð¶ÐµÐ½Ð¸Ñ |
| planned_delivery_date | date | |
| deadline | date | Ð˜Ð· Ð“Ð°Ð½Ñ‚Ð° |
| created_at | timestamptz | default now() |
| updated_by | uuid FK â†’ users | |

### Enum: supply_status
- received (ÐŸÐ¾Ð»ÑƒÑ‡ÐµÐ½Ð¾)
- ordered (Ð—Ð°ÐºÐ°Ð·Ð°Ð½Ð¾)
- not_ordered (ÐÐµ Ð·Ð°ÐºÐ°Ð·Ð°Ð½Ð¾)

## Ð¢Ð°Ð±Ð»Ð¸Ñ†Ð°: invoices
| ÐŸÐ¾Ð»Ðµ | Ð¢Ð¸Ð¿ | ÐžÐ¿Ð¸ÑÐ°Ð½Ð¸Ðµ |
|------|-----|----------|
| id | uuid PK | |
| machine_id | uuid FK â†’ machines UNIQUE NOT NULL | CASCADE DELETE |
| amount | decimal NOT NULL | Ð˜Ð· machines.invoice_amount |
| payment_date | date | ÐÐ’Ð¢Ðž: shipping date_end + 14 Ð´Ð½ÐµÐ¹ |
| status | enum | default 'not_paid' |
| updated_by | uuid FK â†’ users | |
| created_at | timestamptz | default now() |

### Enum: invoice_status
- paid (ÐžÐ¿Ð»Ð°Ñ‡ÐµÐ½Ð¾)
- not_paid (ÐÐµ Ð¾Ð¿Ð»Ð°Ñ‡ÐµÐ½Ð¾)
- overdue (ÐŸÑ€Ð¾ÑÑ€Ð¾Ñ‡ÐµÐ½Ð¾)

## Ð¢Ð°Ð±Ð»Ð¸Ñ†Ð°: notifications
| ÐŸÐ¾Ð»Ðµ | Ð¢Ð¸Ð¿ | ÐžÐ¿Ð¸ÑÐ°Ð½Ð¸Ðµ |
|------|-----|----------|
| id | uuid PK | |
| user_id | uuid FK â†’ users NOT NULL | |
| type | text NOT NULL | Ð¢Ð¸Ð¿ ÑƒÐ²ÐµÐ´Ð¾Ð¼Ð»ÐµÐ½Ð¸Ñ |
| title | text NOT NULL | |
| message | text NOT NULL | |
| is_read | boolean | default false |
| related_machine_id | uuid FK â†’ machines | |
| created_at | timestamptz | default now() |

## Ð¢Ð°Ð±Ð»Ð¸Ñ†Ð°: meetings
| ÐŸÐ¾Ð»Ðµ | Ð¢Ð¸Ð¿ | ÐžÐ¿Ð¸ÑÐ°Ð½Ð¸Ðµ |
|------|-----|----------|
| id | uuid PK | |
| meeting_type | enum NOT NULL | Ð¢Ð¸Ð¿ (general, factory_...) |
| title | text | ÐžÐ¿Ñ†Ð¸Ð¾Ð½Ð°Ð»ÑŒÐ½Ñ‹Ð¹ Ð·Ð°Ð³Ð¾Ð»Ð¾Ð²Ð¾Ðº |
| meeting_date | date NOT NULL | |
| meeting_time | time NOT NULL | |
| status | enum NOT NULL | planned, completed, cancelled |
| notes | text | Ð˜Ñ‚Ð¾Ð³Ð¸ / Ð—Ð°Ð¼ÐµÑ‚ÐºÐ¸ |
| created_by | uuid FK â†’ users | |
| created_at | timestamptz | |
| updated_at | timestamptz | |

### Enum: meeting_type
- general (ÐžÐ±Ñ‰ÐµÐµ)
- factory_bergovo (Берегово)
- factory_uzhgorod (Ð£Ð¶Ð³Ð¾Ñ€Ð¾Ð´)

### Enum: meeting_status
- planned (Ð—Ð°Ð¿Ð»Ð°Ð½Ð¸Ñ€Ð¾Ð²Ð°Ð½Ð¾)
- completed (ÐŸÑ€Ð¾Ð²ÐµÐ´ÐµÐ½Ð¾)
- cancelled (ÐžÑ‚Ð¼ÐµÐ½ÐµÐ½Ð¾)

## Ð¢Ð°Ð±Ð»Ð¸Ñ†Ð°: meeting_attendees
| ÐŸÐ¾Ð»Ðµ | Ð¢Ð¸Ð¿ | ÐžÐ¿Ð¸ÑÐ°Ð½Ð¸Ðµ |
|------|-----|----------|
| id | uuid PK | |
| meeting_id | uuid FK â†’ meetings | CASCADE DELETE |
| user_id | uuid FK â†’ users | UNIQUE(meeting_id, user_id) |
| is_confirmed| boolean | ÐŸÐ¾Ð´Ñ‚Ð²ÐµÑ€Ð´Ð¸Ð» Ð¿Ñ€Ð¸ÑÑƒÑ‚ÑÑ‚Ð²Ð¸Ðµ |
| attended | boolean | Ð ÐµÐ°Ð»ÑŒÐ½Ð¾ Ð¿Ñ€Ð¸ÑÑƒÑ‚ÑÑ‚Ð²Ð¾Ð²Ð°Ð» |

## Ð¢Ð°Ð±Ð»Ð¸Ñ†Ð°: meeting_external_attendees
| ÐŸÐ¾Ð»Ðµ | Ð¢Ð¸Ð¿ | ÐžÐ¿Ð¸ÑÐ°Ð½Ð¸Ðµ |
|------|-----|----------|
| id | uuid PK | |
| meeting_id | uuid FK â†’ meetings | CASCADE DELETE |
| full_name | text NOT NULL | |
| role_description | text | |
| phone, email | text | |
| attended | boolean | |

## Ð¢Ð°Ð±Ð»Ð¸Ñ†Ð°: meeting_agenda_items
| ÐŸÐ¾Ð»Ðµ | Ð¢Ð¸Ð¿ | ÐžÐ¿Ð¸ÑÐ°Ð½Ð¸Ðµ |
|------|-----|----------|
| id | uuid PK | |
| meeting_id | uuid FK â†’ meetings | CASCADE DELETE |
| machine_id | uuid FK â†’ machines | ÐžÐ¿Ñ†Ð¸Ð¾Ð½Ð°Ð»ÑŒÐ½Ð¾ (Ð¿Ñ€Ð¸Ð²ÑÐ·ÐºÐ° Ðº Ð¼Ð°ÑˆÐ¸Ð½Ðµ) |
| title | text NOT NULL | |
| description | text | |
| auto_generated| boolean | Ð¡Ð¾Ð·Ð´Ð°Ð½ CRM |
| sort_order | integer | |

## Ð¢Ð°Ð±Ð»Ð¸Ñ†Ð°: meeting_decisions
| ÐŸÐ¾Ð»Ðµ | Ð¢Ð¸Ð¿ | ÐžÐ¿Ð¸ÑÐ°Ð½Ð¸Ðµ |
|------|-----|----------|
| id | uuid PK | |
| meeting_id | uuid FK â†’ meetings | CASCADE DELETE |
| machine_id | uuid FK â†’ machines | |
| assigned_factory_id| uuid FK â†’ factories| ÐšÐ¾Ð¼Ñƒ Ð¾Ñ‚Ð´Ð°Ð½Ð¾ Ð¿Ñ€Ð¾Ð¸Ð·Ð²Ð¾Ð´ÑÑ‚Ð²Ð¾ |
| assigned_material_type| enum | Ð¢Ð¸Ð¿ Ð¼Ð°Ñ‚ÐµÑ€Ð¸Ð°Ð»Ð° |
| decision_text| text NOT NULL | |
| responsible_user_id| uuid FK â†’ users | |
| deadline | date | |

## Ð¢Ð°Ð±Ð»Ð¸Ñ†Ð°: meeting_action_items
| ÐŸÐ¾Ð»Ðµ | Ð¢Ð¸Ð¿ | ÐžÐ¿Ð¸ÑÐ°Ð½Ð¸Ðµ |
|------|-----|----------|
| id | uuid PK | |
| meeting_id | uuid FK â†’ meetings | CASCADE DELETE |
| description | text NOT NULL | |
| responsible_user_id| uuid FK â†’ users | |
| deadline | date | |
| status | text NOT NULL | 'open' \| 'done' |
## ÐžÐ±Ð½Ð¾Ð²Ð»ÐµÐ½Ð¸Ðµ 27.04.2026: Ð°ÐºÑ‚ÑƒÐ°Ð»ÑŒÐ½Ð°Ñ Ð°Ñ€Ñ…Ð¸Ñ‚ÐµÐºÑ‚ÑƒÑ€Ð° Parts 1-3
- `machines.factory_id` nullable. ÐÐ¾Ð²Ñ‹Ðµ Ð¼Ð°ÑˆÐ¸Ð½Ñ‹ ÑÐ¾Ð·Ð´Ð°ÑŽÑ‚ÑÑ Ð±ÐµÐ· Ð·Ð°Ð²Ð¾Ð´Ð° Ð¸ Ð¿Ð¾Ð»ÑƒÑ‡Ð°ÑŽÑ‚ Ð·Ð°Ð²Ð¾Ð´ Ð¿Ð¾Ð·Ð¶Ðµ.
- `machines.status`: `created`, `under_review`, `factory_assigned`, `in_production`, `shipped`.
- `machines.material_type`: `standard`, `non_standard`, `undefined`.
- `machines.desired_shipping_date`: Ð½ÐµÐ¾Ð±ÑÐ·Ð°Ñ‚ÐµÐ»ÑŒÐ½Ð°Ñ Ð´Ð°Ñ‚Ð°, ÐºÐ¾Ñ‚Ð¾Ñ€ÑƒÑŽ Sales ÑƒÐºÐ°Ð·Ñ‹Ð²Ð°ÐµÑ‚ ÐºÐ°Ðº Ð¶ÐµÐ»Ð°ÐµÐ¼ÑƒÑŽ Ð¾Ñ‚Ð³Ñ€ÑƒÐ·ÐºÑƒ ÐºÐ»Ð¸ÐµÐ½Ñ‚Ð°.
- Ð¡Ñ‚Ð°Ñ€Ñ‹Ðµ Ð¿Ð¾Ð»Ñ ÑÐ¿ÐµÑ†Ð¸Ñ„Ð¸ÐºÐ°Ñ†Ð¸Ð¸ ÑƒÐ´Ð°Ð»ÐµÐ½Ñ‹ Ð¸Ð· `machines`: `tonnage`, `product`, `coating`, `ral_number`, `invoice_amount`, `drawings`.
- Ð¡Ð¿ÐµÑ†Ð¸Ñ„Ð¸ÐºÐ°Ñ†Ð¸Ñ Ð¼Ð°ÑˆÐ¸Ð½Ñ‹ Ñ…Ñ€Ð°Ð½Ð¸Ñ‚ÑÑ Ð² `machine_items`: `drawing_number`, `product_name`, `weight`, `price`, `quantity`, `coating`, `ral_number`, `is_sample`.
- ÐžÐ±Ñ€Ð°Ð·Ñ†Ñ‹ Ñ…Ñ€Ð°Ð½ÑÑ‚ÑÑ Ð² `machine_items` Ñ `is_sample = true` Ð¸ Ð²Ñ…Ð¾Ð´ÑÑ‚ Ð² Ð¾Ð±Ñ‰Ð¸Ð¹ Ð²ÐµÑ, ÑÑ‚Ð¾Ð¸Ð¼Ð¾ÑÑ‚ÑŒ Ð¸ Ñ‚Ñ€ÐµÐ±Ð¾Ð²Ð°Ð½Ð¸Ñ Ðº Ð¿Ð¾ÐºÑ€Ñ‹Ñ‚Ð¸ÑŽ.
- Ð”Ð¾Ð¿Ð¾Ð»Ð½Ð¸Ñ‚ÐµÐ»ÑŒÐ½Ñ‹Ðµ Ñ€Ð°ÑÑ…Ð¾Ð´Ñ‹ Ñ…Ñ€Ð°Ð½ÑÑ‚ÑÑ Ð² `machine_expenses`.
- `machines_with_totals` ÑÑ‡Ð¸Ñ‚Ð°ÐµÑ‚ `total_weight`, `total_items_cost`, `total_expenses`, `total_cost`, `item_count`, `has_zinc`, `has_painting`.
- ÐœÐ¾Ð´ÑƒÐ»ÑŒ meetings Ð¸ÑÐ¿Ð¾Ð»ÑŒÐ·ÑƒÐµÑ‚ Ñ‚Ð°Ð±Ð»Ð¸Ñ†Ñ‹ `meetings`, `meeting_attendees`, `meeting_external_attendees`, `meeting_agenda_items`, `meeting_decisions`, `meeting_action_items`.
- RLS: `production_manager` Ñ‡Ð¸Ñ‚Ð°ÐµÑ‚ Ñ‚Ð¾Ð»ÑŒÐºÐ¾ Ð¼Ð°ÑˆÐ¸Ð½Ñ‹ ÑÐ²Ð¾ÐµÐ³Ð¾ Ð·Ð°Ð²Ð¾Ð´Ð°; Ð¾ÑÑ‚Ð°Ð»ÑŒÐ½Ñ‹Ðµ Ñ€Ð°Ð±Ð¾Ñ‡Ð¸Ðµ Ñ€Ð¾Ð»Ð¸ Ñ‡Ð¸Ñ‚Ð°ÑŽÑ‚ Ð¾Ð±Ð° Ð·Ð°Ð²Ð¾Ð´Ð° Ð¸ Ð¼Ð°ÑˆÐ¸Ð½Ñ‹ Ð±ÐµÐ· Ð·Ð°Ð²Ð¾Ð´Ð° ÑÐ¾Ð³Ð»Ð°ÑÐ½Ð¾ server actions/UI-Ñ„Ð¸Ð»ÑŒÑ‚Ñ€Ñƒ.


## Обновление 23: даты машины и инвойс от доставки клиенту
- `machines.planned_material_date` — плановая дата поставки материала.
- `machines.actual_material_date` — фактическая дата поставки материала.
- `machines.actual_shipping_date` — фактическая дата отгрузки с завода.
- `machines.delivery_to_client_date` — дата доставки клиенту; новый инвойс создаётся/обновляется с `payment_date = delivery_to_client_date + 14 дней`.
- `machines_with_totals` пересоздаётся как `SELECT m.*`, поэтому новые поля доступны через view.
- Старые invoice-триггеры от `production_stages.shipping.date_end` заменены на `trg_upsert_invoice_on_delivery` на таблице `machines`.

## Обновление 24: подтверждение машины
- `machines.is_confirmed boolean NOT NULL DEFAULT false` — признак подтверждения машины Sales-менеджером или директором.
- Машины можно создавать без товаров, образцов и расходов; финансовые и производственные суммы для пустой машины равны `0`.
- `machines_with_totals` пересоздаётся после добавления поля, чтобы `is_confirmed` был доступен в Sales Plan, производстве и Ганте.
- Добавлены триггеры `trg_notify_new_machine` и `trg_notify_confirmation_change`, создающие уведомления директорам и начальникам производства при создании машины и изменении подтверждения.
