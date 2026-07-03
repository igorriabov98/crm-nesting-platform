// Типы базы данных, сгенерированные на основе docs/DATABASE.md
// Отражают полную схему Supabase PostgreSQL

export interface SteelType {
  id: string
  name: string
  density_kg_mm3: number
  created_at: string
}

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  public: {
    Tables: {
      app_settings: {
        Row: {
          key: string
          value: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          key: string
          value?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          key?: string
          value?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      role_permissions: {
        Row: {
          role: Database['public']['Enums']['user_role']
          resource_key: string
          can_view: boolean
          can_manage: boolean
          updated_by: string | null
          updated_at: string
        }
        Insert: {
          role: Database['public']['Enums']['user_role']
          resource_key: string
          can_view?: boolean
          can_manage?: boolean
          updated_by?: string | null
          updated_at?: string
        }
        Update: {
          role?: Database['public']['Enums']['user_role']
          resource_key?: string
          can_view?: boolean
          can_manage?: boolean
          updated_by?: string | null
          updated_at?: string
        }
      }
      role_permission_audit_log: {
        Row: {
          id: string
          role: Database['public']['Enums']['user_role']
          resource_key: string
          old_can_view: boolean | null
          old_can_manage: boolean | null
          new_can_view: boolean
          new_can_manage: boolean
          changed_by: string | null
          changed_at: string
        }
        Insert: {
          id?: string
          role: Database['public']['Enums']['user_role']
          resource_key: string
          old_can_view?: boolean | null
          old_can_manage?: boolean | null
          new_can_view: boolean
          new_can_manage: boolean
          changed_by?: string | null
          changed_at?: string
        }
        Update: {
          id?: string
          role?: Database['public']['Enums']['user_role']
          resource_key?: string
          old_can_view?: boolean | null
          old_can_manage?: boolean | null
          new_can_view?: boolean
          new_can_manage?: boolean
          changed_by?: string | null
          changed_at?: string
        }
      }
      company_settings: {
        Row: {
          id: string
          name_en: string
          name_ua: string
          address_en: string
          director_name_en: string
          director_name_ua: string
          enterprise_code: string
          iban: string
          swift: string
          bank_name: string
          bank_address: string
          delivery_basis_en: string
          delivery_basis_ua: string
          intermediary_bank_name: string
          intermediary_bank_swift: string
          signature_image_path: string | null
          stamp_image_path: string | null
          supply_consumables_department_id: string | null
          auto_task_technologist_user_id: string | null
          auto_task_engineer_user_id: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name_en?: string
          name_ua?: string
          address_en?: string
          director_name_en?: string
          director_name_ua?: string
          enterprise_code?: string
          iban?: string
          swift?: string
          bank_name?: string
          bank_address?: string
          delivery_basis_en?: string
          delivery_basis_ua?: string
          intermediary_bank_name?: string
          intermediary_bank_swift?: string
          signature_image_path?: string | null
          stamp_image_path?: string | null
          supply_consumables_department_id?: string | null
          auto_task_technologist_user_id?: string | null
          auto_task_engineer_user_id?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          name_en?: string
          name_ua?: string
          address_en?: string
          director_name_en?: string
          director_name_ua?: string
          enterprise_code?: string
          iban?: string
          swift?: string
          bank_name?: string
          bank_address?: string
          delivery_basis_en?: string
          delivery_basis_ua?: string
          intermediary_bank_name?: string
          intermediary_bank_swift?: string
          signature_image_path?: string | null
          stamp_image_path?: string | null
          supply_consumables_department_id?: string | null
          auto_task_technologist_user_id?: string | null
          auto_task_engineer_user_id?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      clients: {
        Row: {
          id: string
          name: string
          primary_contact_name: string | null
          phone: string | null
          email: string | null
          country_city: string | null
          address: string | null
          delivery_basis_location_en: string | null
          delivery_basis_location_ua: string | null
          director_name: string | null
          signature_image_path: string | null
          stamp_image_path: string | null
          notes: string | null
          payment_terms_type: Database['public']['Enums']['payment_terms_type']
          payment_due_days: number
          prepayment_percent: number | null
          final_payment_due_days: number | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          primary_contact_name?: string | null
          phone?: string | null
          email?: string | null
          country_city?: string | null
          address?: string | null
          delivery_basis_location_en?: string | null
          delivery_basis_location_ua?: string | null
          director_name?: string | null
          signature_image_path?: string | null
          stamp_image_path?: string | null
          notes?: string | null
          payment_terms_type?: Database['public']['Enums']['payment_terms_type']
          payment_due_days?: number
          prepayment_percent?: number | null
          final_payment_due_days?: number | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          name?: string
          primary_contact_name?: string | null
          phone?: string | null
          email?: string | null
          country_city?: string | null
          address?: string | null
          delivery_basis_location_en?: string | null
          delivery_basis_location_ua?: string | null
          director_name?: string | null
          signature_image_path?: string | null
          stamp_image_path?: string | null
          notes?: string | null
          payment_terms_type?: Database['public']['Enums']['payment_terms_type']
          payment_due_days?: number
          prepayment_percent?: number | null
          final_payment_due_days?: number | null
          created_at?: string
          updated_at?: string
        }
      }
      client_product_prices: {
        Row: {
          id: string
          client_id: string
          product_id: string
          coating: Database['public']['Enums']['coating_type']
          price_eur: number
          created_by: string | null
          updated_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          client_id: string
          product_id: string
          coating: Database['public']['Enums']['coating_type']
          price_eur: number
          created_by?: string | null
          updated_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          client_id?: string
          product_id?: string
          coating?: Database['public']['Enums']['coating_type']
          price_eur?: number
          created_by?: string | null
          updated_by?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      client_contacts: {
        Row: {
          id: string
          client_id: string
          full_name: string
          phone: string | null
          email: string | null
          role_description: string | null
          is_primary: boolean
          notes: string | null
          created_at: string
        }
        Insert: {
          id?: string
          client_id: string
          full_name: string
          phone?: string | null
          email?: string | null
          role_description?: string | null
          is_primary?: boolean
          notes?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          client_id?: string
          full_name?: string
          phone?: string | null
          email?: string | null
          role_description?: string | null
          is_primary?: boolean
          notes?: string | null
          created_at?: string
        }
      }
      contracts: {
        Row: {
          id: string
          number: string
          date: string
          client_id: string
          notes: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          number: string
          date: string
          client_id: string
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          number?: string
          date?: string
          client_id?: string
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      factories: {
        Row: {
          id: string
          name: string
          created_at: string
        }
        Insert: {
          id?: string
          name: string
          created_at?: string
        }
        Update: {
          id?: string
          name?: string
          created_at?: string
        }
      }
      users: {
        Row: {
          id: string
          email: string
          full_name: string
          role: Database['public']['Enums']['user_role']
          factory_id: string
          is_active: boolean
          telegram_chat_id: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          email: string
          full_name: string
          role: Database['public']['Enums']['user_role']
          factory_id: string
          is_active?: boolean
          telegram_chat_id?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          email?: string
          full_name?: string
          role?: Database['public']['Enums']['user_role']
          factory_id?: string
          is_active?: boolean
          telegram_chat_id?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      machines: {
        Row: {
          id: string
          factory_id: string | null
          created_by: string
          name: string
          status: Database['public']['Enums']['machine_status']
          material_type: Database['public']['Enums']['material_type']
          is_confirmed: boolean
          desired_shipping_date: string | null
          planned_material_date: string | null
          actual_material_date: string | null
          actual_shipping_date: string | null
          delivery_to_client_date: string | null
          production_month: string | null
          production_workshop: number | null
          production_queue_number: number | null
          client_id: string | null
          contract_id: string | null
          specification_number: string | null
          specification_date: string | null
          delivery_basis_type: 'own_delivery' | 'partner_truck' | null
          freight_cost: number | null
          packing_boxes_count: number
          packing_gross_weight_kg: number | null
          packing_net_weight_kg: number | null
          packing_summary_en: string | null
          packing_summary_ua: string | null
          payment_terms_type: Database['public']['Enums']['payment_terms_type']
          payment_due_days: number
          prepayment_percent: number | null
          final_payment_due_days: number | null
          is_archived: boolean
          archived_at: string | null
          archived_by: string | null
          archive_reason: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          factory_id?: string | null
          created_by: string
          name: string
          status?: Database['public']['Enums']['machine_status']
          material_type?: Database['public']['Enums']['material_type']
          is_confirmed?: boolean
          desired_shipping_date?: string | null
          planned_material_date?: string | null
          actual_material_date?: string | null
          actual_shipping_date?: string | null
          delivery_to_client_date?: string | null
          production_month?: string | null
          production_workshop?: number | null
          production_queue_number?: number | null
          client_id?: string | null
          contract_id?: string | null
          specification_number?: string | null
          specification_date?: string | null
          delivery_basis_type?: 'own_delivery' | 'partner_truck' | null
          freight_cost?: number | null
          packing_boxes_count?: number
          packing_gross_weight_kg?: number | null
          packing_net_weight_kg?: number | null
          packing_summary_en?: string | null
          packing_summary_ua?: string | null
          payment_terms_type?: Database['public']['Enums']['payment_terms_type']
          payment_due_days?: number
          prepayment_percent?: number | null
          final_payment_due_days?: number | null
          is_archived?: boolean
          archived_at?: string | null
          archived_by?: string | null
          archive_reason?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          factory_id?: string | null
          created_by?: string
          name?: string
          status?: Database['public']['Enums']['machine_status']
          material_type?: Database['public']['Enums']['material_type']
          is_confirmed?: boolean
          desired_shipping_date?: string | null
          planned_material_date?: string | null
          actual_material_date?: string | null
          actual_shipping_date?: string | null
          delivery_to_client_date?: string | null
          production_month?: string | null
          production_workshop?: number | null
          production_queue_number?: number | null
          client_id?: string | null
          contract_id?: string | null
          specification_number?: string | null
          specification_date?: string | null
          delivery_basis_type?: 'own_delivery' | 'partner_truck' | null
          freight_cost?: number | null
          packing_boxes_count?: number
          packing_gross_weight_kg?: number | null
          packing_net_weight_kg?: number | null
          packing_summary_en?: string | null
          packing_summary_ua?: string | null
          payment_terms_type?: Database['public']['Enums']['payment_terms_type']
          payment_due_days?: number
          prepayment_percent?: number | null
          final_payment_due_days?: number | null
          is_archived?: boolean
          archived_at?: string | null
          archived_by?: string | null
          archive_reason?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      machine_updates: {
        Row: {
          id: string
          machine_id: string
          body: string
          created_by: string
          updated_by: string | null
          deleted_by: string | null
          deleted_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          machine_id: string
          body: string
          created_by: string
          updated_by?: string | null
          deleted_by?: string | null
          deleted_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          machine_id?: string
          body?: string
          created_by?: string
          updated_by?: string | null
          deleted_by?: string | null
          deleted_at?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      machine_chat_messages: {
        Row: {
          id: string
          machine_id: string
          body: string
          created_by: string | null
          message_kind: string
          system_event_key: string | null
          created_at: string
        }
        Insert: {
          id?: string
          machine_id: string
          body: string
          created_by?: string | null
          message_kind?: string
          system_event_key?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          machine_id?: string
          body?: string
          created_by?: string | null
          message_kind?: string
          system_event_key?: string | null
          created_at?: string
        }
      }
      machine_chat_mentions: {
        Row: {
          id: string
          message_id: string
          machine_id: string
          user_id: string
          created_at: string
        }
        Insert: {
          id?: string
          message_id: string
          machine_id: string
          user_id: string
          created_at?: string
        }
        Update: {
          id?: string
          message_id?: string
          machine_id?: string
          user_id?: string
          created_at?: string
        }
      }
      machine_items: {
        Row: {
          id: string
          machine_id: string
          product_id: string | null
          product_project_id: string | null
          product_project_version_id: string | null
          drawing_number: string
          product_name: string
          product_name_uk: string | null
          product_name_en: string | null
          product_uktzed: string | null
          product_drawing_number: string | null
          product_characteristics: string | null
          weight: number
          net_weight: number | null
          price: number
          quantity: number
          packing_type: string | null
          packing_places: number | null
          coating: Database['public']['Enums']['coating_type']
          ral_number: string | null
          is_sample: boolean
          sort_order: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          machine_id: string
          product_id?: string | null
          product_project_id?: string | null
          product_project_version_id?: string | null
          drawing_number: string
          product_name: string
          product_name_uk?: string | null
          product_name_en?: string | null
          product_uktzed?: string | null
          product_drawing_number?: string | null
          product_characteristics?: string | null
          weight: number
          net_weight?: number | null
          price: number
          quantity: number
          packing_type?: string | null
          packing_places?: number | null
          coating?: Database['public']['Enums']['coating_type']
          ral_number?: string | null
          is_sample?: boolean
          sort_order?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          machine_id?: string
          product_id?: string | null
          product_project_id?: string | null
          product_project_version_id?: string | null
          drawing_number?: string
          product_name?: string
          product_name_uk?: string | null
          product_name_en?: string | null
          product_uktzed?: string | null
          product_drawing_number?: string | null
          product_characteristics?: string | null
          weight?: number
          net_weight?: number | null
          price?: number
          quantity?: number
          packing_type?: string | null
          packing_places?: number | null
          coating?: Database['public']['Enums']['coating_type']
          ral_number?: string | null
          is_sample?: boolean
          sort_order?: number
          created_at?: string
          updated_at?: string
        }
      }
      machine_item_nesting_runs: {
        Row: {
          id: string
          machine_id: string
          machine_item_id: string
          product_id: string
          step_file_id: string
          drawing_file_id: string
          nesting_project_id: string
          batch_id: string | null
          status: 'draft' | 'calculated' | 'imported' | 'error'
          quantity_multiplier: number
          error_message: string | null
          created_by: string | null
          updated_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          machine_id: string
          machine_item_id: string
          product_id: string
          step_file_id: string
          drawing_file_id: string
          nesting_project_id: string
          batch_id?: string | null
          status?: 'draft' | 'calculated' | 'imported' | 'error'
          quantity_multiplier?: number
          error_message?: string | null
          created_by?: string | null
          updated_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          machine_id?: string
          machine_item_id?: string
          product_id?: string
          step_file_id?: string
          drawing_file_id?: string
          nesting_project_id?: string
          batch_id?: string | null
          status?: 'draft' | 'calculated' | 'imported' | 'error'
          quantity_multiplier?: number
          error_message?: string | null
          created_by?: string | null
          updated_by?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      nesting_batches: {
        Row: {
          id: string
          nesting_project_id: string
          order_number: string
          status: 'draft' | 'parsing' | 'parsed' | 'calculating' | 'done' | 'completed_with_warnings' | 'error'
          error_message: string | null
          source_nesting_project_id: string | null
          is_future_fill: boolean
          created_by: string | null
          updated_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          nesting_project_id: string
          order_number: string
          status?: 'draft' | 'parsing' | 'parsed' | 'calculating' | 'done' | 'completed_with_warnings' | 'error'
          error_message?: string | null
          source_nesting_project_id?: string | null
          is_future_fill?: boolean
          created_by?: string | null
          updated_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          nesting_project_id?: string
          order_number?: string
          status?: 'draft' | 'parsing' | 'parsed' | 'calculating' | 'done' | 'completed_with_warnings' | 'error'
          error_message?: string | null
          source_nesting_project_id?: string | null
          is_future_fill?: boolean
          created_by?: string | null
          updated_by?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      nesting_batch_items: {
        Row: {
          id: string
          batch_id: string
          machine_id: string
          machine_item_id: string
          product_id: string
          step_file_id: string
          drawing_file_id: string
          quantity_multiplier: number
          sort_order: number
          fill_role: 'original' | 'future'
          created_at: string
        }
        Insert: {
          id?: string
          batch_id: string
          machine_id: string
          machine_item_id: string
          product_id: string
          step_file_id: string
          drawing_file_id: string
          quantity_multiplier?: number
          sort_order?: number
          fill_role?: 'original' | 'future'
          created_at?: string
        }
        Update: {
          id?: string
          batch_id?: string
          machine_id?: string
          machine_item_id?: string
          product_id?: string
          step_file_id?: string
          drawing_file_id?: string
          quantity_multiplier?: number
          sort_order?: number
          fill_role?: 'original' | 'future'
          created_at?: string
        }
      }
      nesting_precut_parts: {
        Row: {
          id: string
          machine_id: string
          machine_item_id: string
          product_id: string | null
          part_id: string | null
          part_name: string
          quantity: number
          source_nesting_project_id: string
          source_nesting_sheet_id: string | null
          source_nesting_placement: Json | null
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          machine_id: string
          machine_item_id: string
          product_id?: string | null
          part_id?: string | null
          part_name: string
          quantity: number
          source_nesting_project_id: string
          source_nesting_sheet_id?: string | null
          source_nesting_placement?: Json | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          machine_id?: string
          machine_item_id?: string
          product_id?: string | null
          part_id?: string | null
          part_name?: string
          quantity?: number
          source_nesting_project_id?: string
          source_nesting_sheet_id?: string | null
          source_nesting_placement?: Json | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      machine_expenses: {
        Row: {
          id: string
          machine_id: string
          category: string
          amount: number
          comment: string | null
          created_at: string
        }
        Insert: {
          id?: string
          machine_id: string
          category: string
          amount: number
          comment?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          machine_id?: string
          category?: string
          amount?: number
          comment?: string | null
          created_at?: string
        }
      }
      machine_packing_groups: {
        Row: {
          id: string
          machine_id: string
          start_item_number: number
          end_item_number: number
          packing_type_en: string
          packing_type_ua: string | null
          places: number
          sort_order: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          machine_id: string
          start_item_number: number
          end_item_number: number
          packing_type_en: string
          packing_type_ua?: string | null
          places: number
          sort_order?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          machine_id?: string
          start_item_number?: number
          end_item_number?: number
          packing_type_en?: string
          packing_type_ua?: string | null
          places?: number
          sort_order?: number
          created_at?: string
          updated_at?: string
        }
      }
      products: {
        Row: {
          id: string
          name_uk: string
          name_en: string
          uktzed: string
          drawing_number: string
          characteristics: string
          unit_weight_kg: number
          base_price_eur: number
          status: 'draft' | 'active' | 'archived'
          source_project_id: string | null
          source_version_id: string | null
          created_by: string | null
          updated_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name_uk: string
          name_en: string
          uktzed: string
          drawing_number: string
          characteristics?: string
          unit_weight_kg: number
          base_price_eur?: number
          status?: 'draft' | 'active' | 'archived'
          source_project_id?: string | null
          source_version_id?: string | null
          created_by?: string | null
          updated_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          name_uk?: string
          name_en?: string
          uktzed?: string
          drawing_number?: string
          characteristics?: string
          unit_weight_kg?: number
          base_price_eur?: number
          status?: 'draft' | 'active' | 'archived'
          source_project_id?: string | null
          source_version_id?: string | null
          created_by?: string | null
          updated_by?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      product_files: {
        Row: {
          id: string
          product_id: string
          file_kind: 'drawing' | 'step' | 'pdf' | 'photo' | 'other'
          file_name: string
          file_path: string
          mime_type: string | null
          file_size: number | null
          uploaded_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          product_id: string
          file_kind: 'drawing' | 'step' | 'pdf' | 'photo' | 'other'
          file_name: string
          file_path: string
          mime_type?: string | null
          file_size?: number | null
          uploaded_by?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          product_id?: string
          file_kind?: 'drawing' | 'step' | 'pdf' | 'photo' | 'other'
          file_name?: string
          file_path?: string
          mime_type?: string | null
          file_size?: number | null
          uploaded_by?: string | null
          created_at?: string
        }
      }
      product_projects: {
        Row: {
          id: string
          title: string
          client_id: string | null
          description: string
          characteristics: string
          client_wishes: string
          assigned_engineer_id: string
          status: 'new_project' | 'draft' | 'engineering' | 'client_review' | 'approved' | 'added_to_products' | 'cancelled'
          approved_version_id: string | null
          created_by: string | null
          updated_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          title: string
          client_id?: string | null
          description?: string
          characteristics?: string
          client_wishes?: string
          assigned_engineer_id: string
          status?: 'new_project' | 'draft' | 'engineering' | 'client_review' | 'approved' | 'added_to_products' | 'cancelled'
          approved_version_id?: string | null
          created_by?: string | null
          updated_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          title?: string
          client_id?: string | null
          description?: string
          characteristics?: string
          client_wishes?: string
          assigned_engineer_id?: string
          status?: 'new_project' | 'draft' | 'engineering' | 'client_review' | 'approved' | 'added_to_products' | 'cancelled'
          approved_version_id?: string | null
          created_by?: string | null
          updated_by?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      product_project_versions: {
        Row: {
          id: string
          project_id: string
          version_number: number
          version_label: string | null
          description: string
          characteristics: string
          client_wishes: string
          name_uk: string | null
          name_en: string | null
          uktzed: string | null
          drawing_number: string | null
          unit_weight_kg: number | null
          base_price_eur: number | null
          status: 'draft' | 'client_review' | 'approved' | 'superseded'
          created_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          project_id: string
          version_number: number
          version_label?: string | null
          description?: string
          characteristics?: string
          client_wishes?: string
          name_uk?: string | null
          name_en?: string | null
          uktzed?: string | null
          drawing_number?: string | null
          unit_weight_kg?: number | null
          base_price_eur?: number | null
          status?: 'draft' | 'client_review' | 'approved' | 'superseded'
          created_by?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          project_id?: string
          version_number?: number
          version_label?: string | null
          description?: string
          characteristics?: string
          client_wishes?: string
          name_uk?: string | null
          name_en?: string | null
          uktzed?: string | null
          drawing_number?: string | null
          unit_weight_kg?: number | null
          base_price_eur?: number | null
          status?: 'draft' | 'client_review' | 'approved' | 'superseded'
          created_by?: string | null
          created_at?: string
        }
      }
      product_project_files: {
        Row: {
          id: string
          project_id: string
          version_id: string | null
          file_kind: 'drawing' | 'step' | 'pdf' | 'photo' | 'other'
          file_name: string
          file_path: string
          mime_type: string | null
          file_size: number | null
          uploaded_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          project_id: string
          version_id?: string | null
          file_kind: 'drawing' | 'step' | 'pdf' | 'photo' | 'other'
          file_name: string
          file_path: string
          mime_type?: string | null
          file_size?: number | null
          uploaded_by?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          project_id?: string
          version_id?: string | null
          file_kind?: 'drawing' | 'step' | 'pdf' | 'photo' | 'other'
          file_name?: string
          file_path?: string
          mime_type?: string | null
          file_size?: number | null
          uploaded_by?: string | null
          created_at?: string
        }
      }
      meetings: {
        Row: {
          id: string
          meeting_type: string
          title: string | null
          meeting_date: string
          meeting_time: string
          duration_minutes: number
          status: Database['public']['Enums']['meeting_status']
          notes: string | null
          recurrence_rule_id: string | null
          recurrence_occurrence_date: string | null
          created_by: string | null
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          meeting_type: string
          title?: string | null
          meeting_date: string
          meeting_time?: string
          duration_minutes?: number
          status?: Database['public']['Enums']['meeting_status']
          notes?: string | null
          recurrence_rule_id?: string | null
          recurrence_occurrence_date?: string | null
          created_by?: string | null
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          meeting_type?: string
          title?: string | null
          meeting_date?: string
          meeting_time?: string
          duration_minutes?: number
          status?: Database['public']['Enums']['meeting_status']
          notes?: string | null
          recurrence_rule_id?: string | null
          recurrence_occurrence_date?: string | null
          created_by?: string | null
          created_at?: string | null
          updated_at?: string | null
        }
      }
      meeting_recurrence_rules: {
        Row: {
          id: string
          meeting_type: string
          title: string | null
          meeting_time: string
          duration_minutes: number
          weekdays: number[]
          start_date: string
          end_date: string | null
          occurrence_count: number | null
          attendee_ids: string[]
          external_attendees: unknown
          is_active: boolean
          created_by: string | null
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          meeting_type: string
          title?: string | null
          meeting_time?: string
          duration_minutes?: number
          weekdays: number[]
          start_date: string
          end_date?: string | null
          occurrence_count?: number | null
          attendee_ids?: string[]
          external_attendees?: unknown
          is_active?: boolean
          created_by?: string | null
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          meeting_type?: string
          title?: string | null
          meeting_time?: string
          duration_minutes?: number
          weekdays?: number[]
          start_date?: string
          end_date?: string | null
          occurrence_count?: number | null
          attendee_ids?: string[]
          external_attendees?: unknown
          is_active?: boolean
          created_by?: string | null
          created_at?: string | null
          updated_at?: string | null
        }
      }
      meeting_types: {
        Row: {
          key: string
          label: string
          color: string
          is_system: boolean
          is_active: boolean
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          key: string
          label: string
          color?: string
          is_system?: boolean
          is_active?: boolean
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          key?: string
          label?: string
          color?: string
          is_system?: boolean
          is_active?: boolean
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      meeting_attendees: {
        Row: {
          id: string
          meeting_id: string
          user_id: string
          is_confirmed: boolean | null
          attended: boolean | null
          created_at: string | null
        }
        Insert: {
          id?: string
          meeting_id: string
          user_id: string
          is_confirmed?: boolean | null
          attended?: boolean | null
          created_at?: string | null
        }
        Update: {
          id?: string
          meeting_id?: string
          user_id?: string
          is_confirmed?: boolean | null
          attended?: boolean | null
          created_at?: string | null
        }
      }
      meeting_external_attendees: {
        Row: {
          id: string
          meeting_id: string
          full_name: string
          role_description: string | null
          phone: string | null
          email: string | null
          attended: boolean | null
          created_at: string | null
        }
        Insert: {
          id?: string
          meeting_id: string
          full_name: string
          role_description?: string | null
          phone?: string | null
          email?: string | null
          attended?: boolean | null
          created_at?: string | null
        }
        Update: {
          id?: string
          meeting_id?: string
          full_name?: string
          role_description?: string | null
          phone?: string | null
          email?: string | null
          attended?: boolean | null
          created_at?: string | null
        }
      }
      meeting_agenda_items: {
        Row: {
          id: string
          meeting_id: string
          machine_id: string | null
          title: string
          description: string | null
          auto_generated: boolean | null
          source_key: string | null
          source_type: string | null
          resolved_at: string | null
          resolved_by: string | null
          resolved_decision_id: string | null
          carried_from_item_id: string | null
          sort_order: number
          created_at: string | null
        }
        Insert: {
          id?: string
          meeting_id: string
          machine_id?: string | null
          title: string
          description?: string | null
          auto_generated?: boolean | null
          source_key?: string | null
          source_type?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          resolved_decision_id?: string | null
          carried_from_item_id?: string | null
          sort_order?: number
          created_at?: string | null
        }
        Update: {
          id?: string
          meeting_id?: string
          machine_id?: string | null
          title?: string
          description?: string | null
          auto_generated?: boolean | null
          source_key?: string | null
          source_type?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          resolved_decision_id?: string | null
          carried_from_item_id?: string | null
          sort_order?: number
          created_at?: string | null
        }
      }
      meeting_decisions: {
        Row: {
          id: string
          meeting_id: string
          machine_id: string | null
          assigned_factory_id: string | null
          assigned_material_type: Database['public']['Enums']['material_type'] | null
          decision_text: string
          responsible_user_id: string | null
          deadline: string | null
          created_at: string | null
        }
        Insert: {
          id?: string
          meeting_id: string
          machine_id?: string | null
          assigned_factory_id?: string | null
          assigned_material_type?: Database['public']['Enums']['material_type'] | null
          decision_text: string
          responsible_user_id?: string | null
          deadline?: string | null
          created_at?: string | null
        }
        Update: {
          id?: string
          meeting_id?: string
          machine_id?: string | null
          assigned_factory_id?: string | null
          assigned_material_type?: Database['public']['Enums']['material_type'] | null
          decision_text?: string
          responsible_user_id?: string | null
          deadline?: string | null
          created_at?: string | null
        }
      }
      meeting_action_items: {
        Row: {
          id: string
          meeting_id: string
          title: string
          description: string | null
          responsible_user_id: string | null
          deadline: string | null
          status: 'open' | 'done'
          related_task_id: string | null
          created_at: string | null
        }
        Insert: {
          id?: string
          meeting_id: string
          title: string
          description?: string | null
          responsible_user_id?: string | null
          deadline?: string | null
          status?: 'open' | 'done'
          related_task_id?: string | null
          created_at?: string | null
        }
        Update: {
          id?: string
          meeting_id?: string
          title?: string
          description?: string | null
          responsible_user_id?: string | null
          deadline?: string | null
          status?: 'open' | 'done'
          related_task_id?: string | null
          created_at?: string | null
        }
      }
      production_stages: {
        Row: {
          id: string
          machine_id: string
          stage_type: Database['public']['Enums']['stage_type']
          workshop: number | null
          date_start: string | null
          date_end: string | null
          planned_date_end: string | null
          manual_overdue: boolean
          is_skipped: boolean
          is_night_shift: boolean
          night_shift_date: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          machine_id: string
          stage_type: Database['public']['Enums']['stage_type']
          workshop?: number | null
          date_start?: string | null
          date_end?: string | null
          planned_date_end?: string | null
          manual_overdue?: boolean
          is_skipped?: boolean
          is_night_shift?: boolean
          night_shift_date?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          machine_id?: string
          stage_type?: Database['public']['Enums']['stage_type']
          workshop?: number | null
          date_start?: string | null
          date_end?: string | null
          planned_date_end?: string | null
          manual_overdue?: boolean
          is_skipped?: boolean
          is_night_shift?: boolean
          night_shift_date?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      production_fact_sections: {
        Row: {
          id: string
          factory_id: string
          parent_id: string | null
          name: string
          sort_order: number
          production_stage_type: Database['public']['Enums']['stage_type'] | null
          is_active: boolean
          archived_at: string | null
          created_by: string | null
          updated_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          factory_id: string
          parent_id?: string | null
          name: string
          sort_order?: number
          production_stage_type?: Database['public']['Enums']['stage_type'] | null
          is_active?: boolean
          archived_at?: string | null
          created_by?: string | null
          updated_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          factory_id?: string
          parent_id?: string | null
          name?: string
          sort_order?: number
          production_stage_type?: Database['public']['Enums']['stage_type'] | null
          is_active?: boolean
          archived_at?: string | null
          created_by?: string | null
          updated_by?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      production_machine_facts: {
        Row: {
          id: string
          factory_id: string
          fact_date: string
          shift: Database['public']['Enums']['production_fact_shift']
          machine_id: string
          section_id: string
          comment: string | null
          created_by: string | null
          updated_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          factory_id: string
          fact_date: string
          shift: Database['public']['Enums']['production_fact_shift']
          machine_id: string
          section_id: string
          comment?: string | null
          created_by?: string | null
          updated_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          factory_id?: string
          fact_date?: string
          shift?: Database['public']['Enums']['production_fact_shift']
          machine_id?: string
          section_id?: string
          comment?: string | null
          created_by?: string | null
          updated_by?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      production_fact_cutting_events: {
        Row: {
          id: string
          machine_id: string
          factory_id: string | null
          fact_id: string | null
          section_id: string | null
          fact_date: string
          stage_id: string | null
          previous_stage_date_start: string | null
          applied_stage_date_start: string | null
          status: 'applied' | 'rolled_back' | 'kept' | 'blocked'
          rollback_task_id: string | null
          created_by: string | null
          created_at: string
          rolled_back_by: string | null
          rolled_back_at: string | null
          rollback_comment: string | null
          kept_by: string | null
          kept_at: string | null
          keep_comment: string | null
        }
        Insert: {
          id?: string
          machine_id: string
          factory_id?: string | null
          fact_id?: string | null
          section_id?: string | null
          fact_date: string
          stage_id?: string | null
          previous_stage_date_start?: string | null
          applied_stage_date_start?: string | null
          status?: 'applied' | 'rolled_back' | 'kept' | 'blocked'
          rollback_task_id?: string | null
          created_by?: string | null
          created_at?: string
          rolled_back_by?: string | null
          rolled_back_at?: string | null
          rollback_comment?: string | null
          kept_by?: string | null
          kept_at?: string | null
          keep_comment?: string | null
        }
        Update: {
          id?: string
          machine_id?: string
          factory_id?: string | null
          fact_id?: string | null
          section_id?: string | null
          fact_date?: string
          stage_id?: string | null
          previous_stage_date_start?: string | null
          applied_stage_date_start?: string | null
          status?: 'applied' | 'rolled_back' | 'kept' | 'blocked'
          rollback_task_id?: string | null
          created_by?: string | null
          created_at?: string
          rolled_back_by?: string | null
          rolled_back_at?: string | null
          rollback_comment?: string | null
          kept_by?: string | null
          kept_at?: string | null
          keep_comment?: string | null
        }
      }
      production_fact_cutting_event_reservations: {
        Row: {
          id: string
          event_id: string
          reservation_id: string | null
          inventory_id: string
          material_id: string
          material_variant_id: string | null
          request_item_table: string
          request_item_id: string
          reserved_quantity: number
          reserved_secondary_quantity: number | null
          is_cut_reservation: boolean
          created_at: string
        }
        Insert: {
          id?: string
          event_id: string
          reservation_id?: string | null
          inventory_id: string
          material_id: string
          material_variant_id?: string | null
          request_item_table: string
          request_item_id: string
          reserved_quantity: number
          reserved_secondary_quantity?: number | null
          is_cut_reservation?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          event_id?: string
          reservation_id?: string | null
          inventory_id?: string
          material_id?: string
          material_variant_id?: string | null
          request_item_table?: string
          request_item_id?: string
          reserved_quantity?: number
          reserved_secondary_quantity?: number | null
          is_cut_reservation?: boolean
          created_at?: string
        }
      }
      production_fact_cutting_event_scrap_promotions: {
        Row: {
          id: string
          event_id: string
          inventory_id: string
          previous_business_scrap_state: string
          created_at: string
        }
        Insert: {
          id?: string
          event_id: string
          inventory_id: string
          previous_business_scrap_state?: string
          created_at?: string
        }
        Update: {
          id?: string
          event_id?: string
          inventory_id?: string
          previous_business_scrap_state?: string
          created_at?: string
        }
      }
      production_month_plans: {
        Row: {
          id: string
          factory_id: string
          production_month: string
          status: Database['public']['Enums']['production_month_plan_status']
          preliminary_ready_at: string | null
          preliminary_ready_by: string | null
          confirmed_at: string | null
          confirmed_by: string | null
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          factory_id: string
          production_month: string
          status?: Database['public']['Enums']['production_month_plan_status']
          preliminary_ready_at?: string | null
          preliminary_ready_by?: string | null
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          factory_id?: string
          production_month?: string
          status?: Database['public']['Enums']['production_month_plan_status']
          preliminary_ready_at?: string | null
          preliminary_ready_by?: string | null
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      production_plan_date_change_requests: {
        Row: {
          id: string
          production_month_plan_id: string
          machine_id: string
          requested_by: string
          decided_by: string | null
          task_id: string | null
          status: Database['public']['Enums']['production_date_change_request_status']
          comment: string | null
          decision_comment: string | null
          created_at: string
          updated_at: string
          decided_at: string | null
        }
        Insert: {
          id?: string
          production_month_plan_id: string
          machine_id: string
          requested_by: string
          decided_by?: string | null
          task_id?: string | null
          status?: Database['public']['Enums']['production_date_change_request_status']
          comment?: string | null
          decision_comment?: string | null
          created_at?: string
          updated_at?: string
          decided_at?: string | null
        }
        Update: {
          id?: string
          production_month_plan_id?: string
          machine_id?: string
          requested_by?: string
          decided_by?: string | null
          task_id?: string | null
          status?: Database['public']['Enums']['production_date_change_request_status']
          comment?: string | null
          decision_comment?: string | null
          created_at?: string
          updated_at?: string
          decided_at?: string | null
        }
      }
      production_plan_date_change_request_items: {
        Row: {
          id: string
          request_id: string
          machine_id: string
          target_type: 'machine' | 'stage'
          production_stage_id: string | null
          stage_type: Database['public']['Enums']['stage_type'] | null
          field_name: string
          old_value: string | null
          new_value: string | null
          status: Database['public']['Enums']['production_date_change_request_status']
          sort_order: number
          created_at: string
          decided_at: string | null
        }
        Insert: {
          id?: string
          request_id: string
          machine_id: string
          target_type: 'machine' | 'stage'
          production_stage_id?: string | null
          stage_type?: Database['public']['Enums']['stage_type'] | null
          field_name: string
          old_value?: string | null
          new_value?: string | null
          status?: Database['public']['Enums']['production_date_change_request_status']
          sort_order?: number
          created_at?: string
          decided_at?: string | null
        }
        Update: {
          id?: string
          request_id?: string
          machine_id?: string
          target_type?: 'machine' | 'stage'
          production_stage_id?: string | null
          stage_type?: Database['public']['Enums']['stage_type'] | null
          field_name?: string
          old_value?: string | null
          new_value?: string | null
          status?: Database['public']['Enums']['production_date_change_request_status']
          sort_order?: number
          created_at?: string
          decided_at?: string | null
        }
      }
      production_tonnage_facts: {
        Row: {
          id: string
          factory_id: string
          fact_date: string
          section_id: string
          tonnage: number
          comment: string | null
          created_by: string | null
          updated_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          factory_id: string
          fact_date: string
          section_id: string
          tonnage?: number
          comment?: string | null
          created_by?: string | null
          updated_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          factory_id?: string
          fact_date?: string
          section_id?: string
          tonnage?: number
          comment?: string | null
          created_by?: string | null
          updated_by?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      supply_items: {
        Row: {
          id: string
          machine_id: string
          nomenclature: string | null
          unit: string | null
          quantity: number | null
          supplier: string | null
          price_per_unit: number | null
          status: Database['public']['Enums']['supply_status']
          comment: string | null
          planned_delivery_date: string | null
          engineer_confirmation: boolean
          engineer_deadline: string | null
          technologist_deadline: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          machine_id: string
          nomenclature?: string | null
          unit?: string | null
          quantity?: number | null
          supplier?: string | null
          price_per_unit?: number | null
          status?: Database['public']['Enums']['supply_status']
          comment?: string | null
          planned_delivery_date?: string | null
          engineer_confirmation?: boolean
          engineer_deadline?: string | null
          technologist_deadline?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          machine_id?: string
          nomenclature?: string | null
          unit?: string | null
          quantity?: number | null
          supplier?: string | null
          price_per_unit?: number | null
          status?: Database['public']['Enums']['supply_status']
          comment?: string | null
          planned_delivery_date?: string | null
          engineer_confirmation?: boolean
          engineer_deadline?: string | null
          technologist_deadline?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      invoices: {
        Row: {
          id: string
          machine_id: string
          amount: number | null
          payment_date: string | null
          invoice_date: string
          due_date: string | null
          paid_amount: number
          balance_due_date: string | null
          payment_note: string | null
          status: Database['public']['Enums']['invoice_status']
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          machine_id: string
          amount?: number | null
          payment_date?: string | null
          invoice_date?: string
          due_date?: string | null
          paid_amount?: number
          balance_due_date?: string | null
          payment_note?: string | null
          status?: Database['public']['Enums']['invoice_status']
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          machine_id?: string
          amount?: number | null
          payment_date?: string | null
          invoice_date?: string
          due_date?: string | null
          paid_amount?: number
          balance_due_date?: string | null
          payment_note?: string | null
          status?: Database['public']['Enums']['invoice_status']
          created_at?: string
          updated_at?: string
        }
      }
      notifications: {
        Row: {
          id: string
          user_id: string
          type: string
          title: string
          message: string
          related_machine_id: string | null
          consumable_request_id: string | null
          is_read: boolean
          telegram_notified_at: string | null
          telegram_error: string | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          type: string
          title: string
          message: string
          related_machine_id?: string | null
          consumable_request_id?: string | null
          is_read?: boolean
          telegram_notified_at?: string | null
          telegram_error?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          type?: string
          title?: string
          message?: string
          related_machine_id?: string | null
          consumable_request_id?: string | null
          is_read?: boolean
          telegram_notified_at?: string | null
          telegram_error?: string | null
          created_at?: string
        }
      }
      consumable_categories: {
        Row: {
          id: string
          factory_id: string
          name: string
          description: string | null
          is_active: boolean
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          factory_id: string
          name: string
          description?: string | null
          is_active?: boolean
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          factory_id?: string
          name?: string
          description?: string | null
          is_active?: boolean
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      consumables: {
        Row: {
          id: string
          factory_id: string
          category_id: string
          name: string
          characteristics: string
          article: string
          unit: string
          minimum_quantity: number
          is_active: boolean
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          factory_id: string
          category_id: string
          name: string
          characteristics: string
          article: string
          unit: string
          minimum_quantity?: number
          is_active?: boolean
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          factory_id?: string
          category_id?: string
          name?: string
          characteristics?: string
          article?: string
          unit?: string
          minimum_quantity?: number
          is_active?: boolean
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      consumable_balances: {
        Row: {
          consumable_id: string
          factory_id: string
          current_quantity: number
          updated_at: string
        }
        Insert: {
          consumable_id: string
          factory_id: string
          current_quantity?: number
          updated_at?: string
        }
        Update: {
          consumable_id?: string
          factory_id?: string
          current_quantity?: number
          updated_at?: string
        }
      }
      consumable_requests: {
        Row: {
          id: string
          factory_id: string
          consumable_id: string
          created_by: string
          priority: Database['public']['Enums']['consumable_request_priority']
          requested_quantity: number
          received_quantity: number
          status: Database['public']['Enums']['consumable_request_status']
          auto_generated: boolean
          quantity_is_automatic: boolean
          request_date: string | null
          need_by_date: string | null
          submitted_at: string | null
          invoice_taken_at: string | null
          delivery_started_at: string | null
          completed_at: string | null
          cancelled_at: string | null
          cancellation_reason: string | null
          remainder_closed_reason: string | null
          delivery_method: Database['public']['Enums']['consumable_delivery_method'] | null
          nova_poshta_ttn: string | null
          carrier_name: string | null
          carrier_eta: string | null
          tracking_status: string | null
          tracking_status_code: string | null
          tracking_estimated_delivery_date: string | null
          tracking_last_checked_at: string | null
          tracking_error: string | null
          notes: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          factory_id: string
          consumable_id: string
          created_by: string
          priority?: Database['public']['Enums']['consumable_request_priority']
          requested_quantity: number
          received_quantity?: number
          status?: Database['public']['Enums']['consumable_request_status']
          auto_generated?: boolean
          quantity_is_automatic?: boolean
          request_date?: string | null
          need_by_date?: string | null
          submitted_at?: string | null
          invoice_taken_at?: string | null
          delivery_started_at?: string | null
          completed_at?: string | null
          cancelled_at?: string | null
          cancellation_reason?: string | null
          remainder_closed_reason?: string | null
          delivery_method?: Database['public']['Enums']['consumable_delivery_method'] | null
          nova_poshta_ttn?: string | null
          carrier_name?: string | null
          carrier_eta?: string | null
          tracking_status?: string | null
          tracking_status_code?: string | null
          tracking_estimated_delivery_date?: string | null
          tracking_last_checked_at?: string | null
          tracking_error?: string | null
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          factory_id?: string
          consumable_id?: string
          created_by?: string
          priority?: Database['public']['Enums']['consumable_request_priority']
          requested_quantity?: number
          received_quantity?: number
          status?: Database['public']['Enums']['consumable_request_status']
          auto_generated?: boolean
          quantity_is_automatic?: boolean
          request_date?: string | null
          need_by_date?: string | null
          submitted_at?: string | null
          invoice_taken_at?: string | null
          delivery_started_at?: string | null
          completed_at?: string | null
          cancelled_at?: string | null
          cancellation_reason?: string | null
          remainder_closed_reason?: string | null
          delivery_method?: Database['public']['Enums']['consumable_delivery_method'] | null
          nova_poshta_ttn?: string | null
          carrier_name?: string | null
          carrier_eta?: string | null
          tracking_status?: string | null
          tracking_status_code?: string | null
          tracking_estimated_delivery_date?: string | null
          tracking_last_checked_at?: string | null
          tracking_error?: string | null
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      consumable_request_receipts: {
        Row: {
          id: string
          request_id: string
          quantity: number
          received_by: string
          received_at: string
        }
        Insert: {
          id?: string
          request_id: string
          quantity: number
          received_by: string
          received_at?: string
        }
        Update: {
          id?: string
          request_id?: string
          quantity?: number
          received_by?: string
          received_at?: string
        }
      }
      consumable_movements: {
        Row: {
          id: string
          consumable_id: string
          factory_id: string
          movement_type: Database['public']['Enums']['consumable_movement_type']
          quantity_delta: number
          balance_before: number
          balance_after: number
          request_id: string | null
          created_by: string | null
          comment: string | null
          created_at: string
        }
        Insert: {
          id?: string
          consumable_id: string
          factory_id: string
          movement_type: Database['public']['Enums']['consumable_movement_type']
          quantity_delta: number
          balance_before: number
          balance_after: number
          request_id?: string | null
          created_by?: string | null
          comment?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          consumable_id?: string
          factory_id?: string
          movement_type?: Database['public']['Enums']['consumable_movement_type']
          quantity_delta?: number
          balance_before?: number
          balance_after?: number
          request_id?: string | null
          created_by?: string | null
          comment?: string | null
          created_at?: string
        }
      }
      consumable_request_events: {
        Row: {
          id: string
          request_id: string
          event_type: string
          old_status: Database['public']['Enums']['consumable_request_status'] | null
          new_status: Database['public']['Enums']['consumable_request_status'] | null
          details: Json
          created_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          request_id: string
          event_type: string
          old_status?: Database['public']['Enums']['consumable_request_status'] | null
          new_status?: Database['public']['Enums']['consumable_request_status'] | null
          details?: Json
          created_by?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          request_id?: string
          event_type?: string
          old_status?: Database['public']['Enums']['consumable_request_status'] | null
          new_status?: Database['public']['Enums']['consumable_request_status'] | null
          details?: Json
          created_by?: string | null
          created_at?: string
        }
      }
      suppliers: {
        Row: {
          id: string
          name: string
          contact_person: string | null
          phone: string | null
          email: string | null
          notes: string | null
          delivery_lead_days: number
          is_active: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          contact_person?: string | null
          phone?: string | null
          email?: string | null
          notes?: string | null
          delivery_lead_days?: number
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          name?: string
          contact_person?: string | null
          phone?: string | null
          email?: string | null
          notes?: string | null
          delivery_lead_days?: number
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
      }
      materials: {
        Row: {
          id: string
          name: string
          category: Database['public']['Enums']['material_category']
          comment: string | null
          default_supplier_id: string | null
          is_active: boolean
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          category: Database['public']['Enums']['material_category']
          comment?: string | null
          default_supplier_id?: string | null
          is_active?: boolean
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          name?: string
          category?: Database['public']['Enums']['material_category']
          comment?: string | null
          default_supplier_id?: string | null
          is_active?: boolean
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      steel_types: {
        Row: {
          id: string
          name: string
          density_kg_mm3: number
          created_at: string
        }
        Insert: {
          id?: string
          name: string
          density_kg_mm3: number
          created_at?: string
        }
        Update: {
          id?: string
          name?: string
          density_kg_mm3?: number
          created_at?: string
        }
      }
      material_variants: {
        Row: {
          id: string
          factory_id: string
          material_id: string
          category: Database['public']['Enums']['material_category']
          steel_type_id: string | null
          material_grade: string | null
          thickness_mm: number | null
          sheet_size: string | null
          weight_per_unit_kg: number | null
          length_m: number | null
          weight_per_m_kg: number | null
          piece_description: string | null
          knife_dimensions: string | null
          knife_material: string | null
          standard_length_mm: number | null
          specification: string | null
          default_unit: string | null
          ral_code: string | null
          finish: string | null
          default_waste_percent: number | null
          diameter_mm: number | null
          is_calibrated: boolean | null
          pipe_type: Database['public']['Enums']['pipe_subtype'] | null
          wall_thickness_mm: number | null
          width_mm: number | null
          height_mm: number | null
          mesh_description: string | null
          mesh_length_mm: number | null
          mesh_width_mm: number | null
          chain_cord_type: Database['public']['Enums']['chain_cord_subtype'] | null
          chain_cord_parameters: string | null
          unit_weight_kg: number | null
          times_used: number
          last_used_at: string
          created_at: string
        }
        Insert: {
          id?: string
          factory_id: string
          material_id: string
          category: Database['public']['Enums']['material_category']
          steel_type_id?: string | null
          material_grade?: string | null
          thickness_mm?: number | null
          sheet_size?: string | null
          weight_per_unit_kg?: number | null
          length_m?: number | null
          weight_per_m_kg?: number | null
          piece_description?: string | null
          knife_dimensions?: string | null
          knife_material?: string | null
          standard_length_mm?: number | null
          specification?: string | null
          default_unit?: string | null
          ral_code?: string | null
          finish?: string | null
          default_waste_percent?: number | null
          diameter_mm?: number | null
          is_calibrated?: boolean | null
          pipe_type?: Database['public']['Enums']['pipe_subtype'] | null
          wall_thickness_mm?: number | null
          width_mm?: number | null
          height_mm?: number | null
          mesh_description?: string | null
          mesh_length_mm?: number | null
          mesh_width_mm?: number | null
          chain_cord_type?: Database['public']['Enums']['chain_cord_subtype'] | null
          chain_cord_parameters?: string | null
          unit_weight_kg?: number | null
          times_used?: number
          last_used_at?: string
          created_at?: string
        }
        Update: {
          id?: string
          factory_id?: string
          material_id?: string
          category?: Database['public']['Enums']['material_category']
          steel_type_id?: string | null
          material_grade?: string | null
          thickness_mm?: number | null
          sheet_size?: string | null
          weight_per_unit_kg?: number | null
          length_m?: number | null
          weight_per_m_kg?: number | null
          piece_description?: string | null
          knife_dimensions?: string | null
          knife_material?: string | null
          standard_length_mm?: number | null
          specification?: string | null
          default_unit?: string | null
          ral_code?: string | null
          finish?: string | null
          default_waste_percent?: number | null
          diameter_mm?: number | null
          is_calibrated?: boolean | null
          pipe_type?: Database['public']['Enums']['pipe_subtype'] | null
          wall_thickness_mm?: number | null
          width_mm?: number | null
          height_mm?: number | null
          mesh_description?: string | null
          mesh_length_mm?: number | null
          mesh_width_mm?: number | null
          chain_cord_type?: Database['public']['Enums']['chain_cord_subtype'] | null
          chain_cord_parameters?: string | null
          unit_weight_kg?: number | null
          times_used?: number
          last_used_at?: string
          created_at?: string
        }
      }
      inventory: {
        Row: {
          id: string
          material_id: string
          material_variant_id: string | null
          total_quantity: number
          reserved_quantity: number
          available_quantity: number
          unit: string
          total_secondary_quantity: number | null
          reserved_secondary_quantity: number | null
          available_secondary_quantity: number | null
          secondary_unit: string | null
          calculated_weight_kg: number | null
          piece_length_mm: number | null
          is_business_scrap: boolean
          source_inventory_id: string | null
          source_reservation_id: string | null
          source_machine_id: string | null
          source_piece_length_mm: number | null
          business_scrap_state: 'available' | 'future'
          available_from_date: string | null
          available_from_stage_id: string | null
          source_nesting_project_id: string | null
          source_nesting_sheet_id: string | null
          source_remnant_geom: Json | null
          deleted_at: string | null
          deleted_by: string | null
          delete_comment: string | null
          last_updated_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          material_id: string
          material_variant_id?: string | null
          total_quantity?: number
          reserved_quantity?: number
          unit?: string
          total_secondary_quantity?: number | null
          reserved_secondary_quantity?: number | null
          secondary_unit?: string | null
          calculated_weight_kg?: number | null
          piece_length_mm?: number | null
          is_business_scrap?: boolean
          source_inventory_id?: string | null
          source_reservation_id?: string | null
          source_machine_id?: string | null
          source_piece_length_mm?: number | null
          business_scrap_state?: 'available' | 'future'
          available_from_date?: string | null
          available_from_stage_id?: string | null
          source_nesting_project_id?: string | null
          source_nesting_sheet_id?: string | null
          source_remnant_geom?: Json | null
          deleted_at?: string | null
          deleted_by?: string | null
          delete_comment?: string | null
          last_updated_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          material_id?: string
          material_variant_id?: string | null
          total_quantity?: number
          reserved_quantity?: number
          unit?: string
          total_secondary_quantity?: number | null
          reserved_secondary_quantity?: number | null
          secondary_unit?: string | null
          calculated_weight_kg?: number | null
          piece_length_mm?: number | null
          is_business_scrap?: boolean
          source_inventory_id?: string | null
          source_reservation_id?: string | null
          source_machine_id?: string | null
          source_piece_length_mm?: number | null
          business_scrap_state?: 'available' | 'future'
          available_from_date?: string | null
          available_from_stage_id?: string | null
          source_nesting_project_id?: string | null
          source_nesting_sheet_id?: string | null
          source_remnant_geom?: Json | null
          deleted_at?: string | null
          deleted_by?: string | null
          delete_comment?: string | null
          last_updated_by?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      inventory_transactions: {
        Row: {
          id: string
          factory_id: string | null
          inventory_id: string
          material_id: string
          material_variant_id: string | null
          transaction_type: Database['public']['Enums']['inventory_transaction_type']
          quantity: number
          secondary_quantity: number | null
          machine_id: string | null
          request_item_table: string | null
          request_item_id: string | null
          performed_by: string
          supplier_id: string | null
          comment: string | null
          created_at: string
        }
        Insert: {
          id?: string
          factory_id?: string | null
          inventory_id: string
          material_id: string
          material_variant_id?: string | null
          transaction_type: Database['public']['Enums']['inventory_transaction_type']
          quantity: number
          secondary_quantity?: number | null
          machine_id?: string | null
          request_item_table?: string | null
          request_item_id?: string | null
          performed_by: string
          supplier_id?: string | null
          comment?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          factory_id?: string | null
          inventory_id?: string
          material_id?: string
          material_variant_id?: string | null
          transaction_type?: Database['public']['Enums']['inventory_transaction_type']
          quantity?: number
          secondary_quantity?: number | null
          machine_id?: string | null
          request_item_table?: string | null
          request_item_id?: string | null
          performed_by?: string
          supplier_id?: string | null
          comment?: string | null
          created_at?: string
        }
      }
      inventory_reservations: {
        Row: {
          id: string
          inventory_id: string
          material_id: string
          material_variant_id: string | null
          machine_id: string
          request_item_table: string
          request_item_id: string
          reserved_quantity: number
          reserved_secondary_quantity: number | null
          source_inventory_id: string | null
          original_piece_length_mm: number | null
          consumed_piece_count: number | null
          business_scrap_inventory_id: string | null
          business_scrap_quantity: number | null
          is_cut_reservation: boolean
          consumed_at: string | null
          consumed_by: string | null
          consumed_cutting_event_id: string | null
          reserved_by: string
          created_at: string
        }
        Insert: {
          id?: string
          inventory_id: string
          material_id: string
          material_variant_id?: string | null
          machine_id: string
          request_item_table: string
          request_item_id: string
          reserved_quantity: number
          reserved_secondary_quantity?: number | null
          source_inventory_id?: string | null
          original_piece_length_mm?: number | null
          consumed_piece_count?: number | null
          business_scrap_inventory_id?: string | null
          business_scrap_quantity?: number | null
          is_cut_reservation?: boolean
          consumed_at?: string | null
          consumed_by?: string | null
          consumed_cutting_event_id?: string | null
          reserved_by: string
          created_at?: string
        }
        Update: {
          id?: string
          inventory_id?: string
          material_id?: string
          material_variant_id?: string | null
          machine_id?: string
          request_item_table?: string
          request_item_id?: string
          reserved_quantity?: number
          reserved_secondary_quantity?: number | null
          source_inventory_id?: string | null
          original_piece_length_mm?: number | null
          consumed_piece_count?: number | null
          business_scrap_inventory_id?: string | null
          business_scrap_quantity?: number | null
          is_cut_reservation?: boolean
          consumed_at?: string | null
          consumed_by?: string | null
          consumed_cutting_event_id?: string | null
          reserved_by?: string
          created_at?: string
        }
      }
      supplier_delivery_days: {
        Row: {
          id: string
          supplier_id: string
          day_of_week: number
          created_at: string
        }
        Insert: {
          id?: string
          supplier_id: string
          day_of_week: number
          created_at?: string
        }
        Update: {
          id?: string
          supplier_id?: string
          day_of_week?: number
          created_at?: string
        }
      }
      supplier_material_categories: {
        Row: {
          id: string
          supplier_id: string
          category: Database['public']['Enums']['material_category']
          created_at: string
        }
        Insert: {
          id?: string
          supplier_id: string
          category: Database['public']['Enums']['material_category']
          created_at?: string
        }
        Update: {
          id?: string
          supplier_id?: string
          category?: Database['public']['Enums']['material_category']
          created_at?: string
        }
      }
      meeting_agenda_pool_items: {
        Row: {
          id: string
          source_key: string
          source_type: string
          machine_id: string | null
          title: string
          description: string | null
          status: string
          assigned_meeting_id: string | null
          assigned_at: string | null
          dismissed_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          source_key: string
          source_type: string
          machine_id?: string | null
          title: string
          description?: string | null
          status?: string
          assigned_meeting_id?: string | null
          assigned_at?: string | null
          dismissed_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          source_key?: string
          source_type?: string
          machine_id?: string | null
          title?: string
          description?: string | null
          status?: string
          assigned_meeting_id?: string | null
          assigned_at?: string | null
          dismissed_at?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      task_delegations: {
        Row: {
          id: string
          task_id: string
          delegated_by: string
          delegated_from: string
          delegated_to: string
          department_id: string
          status: Database['public']['Enums']['task_delegation_status']
          note: string | null
          decline_reason: string | null
          delegated_at: string
          responded_at: string | null
        }
        Insert: {
          id?: string
          task_id: string
          delegated_by: string
          delegated_from: string
          delegated_to: string
          department_id: string
          status?: Database['public']['Enums']['task_delegation_status']
          note?: string | null
          decline_reason?: string | null
          delegated_at?: string
          responded_at?: string | null
        }
        Update: {
          id?: string
          task_id?: string
          delegated_by?: string
          delegated_from?: string
          delegated_to?: string
          department_id?: string
          status?: Database['public']['Enums']['task_delegation_status']
          note?: string | null
          decline_reason?: string | null
          delegated_at?: string
          responded_at?: string | null
        }
      }
      tasks: {
        Row: {
          id: string
          machine_id: string | null
          related_meeting_id: string | null
          product_project_id: string | null
          consumable_request_id: string | null
          supply_order_schedule_id: string | null
          assigned_to: string
          task_type: Database['public']['Enums']['task_type']
          title: string
          description: string | null
          status: Database['public']['Enums']['task_status']
          start_date: string | null
          deadline: string
          completed_at: string | null
          notified_at: string | null
          telegram_error: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          machine_id?: string | null
          related_meeting_id?: string | null
          product_project_id?: string | null
          consumable_request_id?: string | null
          supply_order_schedule_id?: string | null
          assigned_to: string
          task_type: Database['public']['Enums']['task_type']
          title: string
          description?: string | null
          status?: Database['public']['Enums']['task_status']
          start_date?: string | null
          deadline: string
          completed_at?: string | null
          notified_at?: string | null
          telegram_error?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          machine_id?: string | null
          related_meeting_id?: string | null
          product_project_id?: string | null
          consumable_request_id?: string | null
          supply_order_schedule_id?: string | null
          assigned_to?: string
          task_type?: Database['public']['Enums']['task_type']
          title?: string
          description?: string | null
          status?: Database['public']['Enums']['task_status']
          start_date?: string | null
          deadline?: string
          completed_at?: string | null
          notified_at?: string | null
          telegram_error?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      technologist_requests: {
        Row: {
          id: string
          machine_id: string
          created_by: string
          status: Database['public']['Enums']['request_status']
          notes: string | null
          submitted_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          machine_id: string
          created_by: string
          status?: Database['public']['Enums']['request_status']
          notes?: string | null
          submitted_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          machine_id?: string
          created_by?: string
          status?: Database['public']['Enums']['request_status']
          notes?: string | null
          submitted_at?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      request_sheet_metal: {
        Row: {
          id: string
          request_id: string
          material_name: string
          material_grade: string | null
          thickness_mm: number | null
          sheet_size: string | null
          quantity_sheets: number
          weight_order_kg: number
          weight_scrap_kg: number | null
          scrap_percent: number | null
          stock_on_hand_kg: number | null
          stock_sheet_size: string | null
          additional_parts_kg: number | null
          business_scrap_kg: number | null
          stock_parts_kg: number | null
          to_order_kg: number
          supplier_id: string | null
          sort_order: number
          created_at: string
          order_status: Database['public']['Enums']['order_item_status']
          ordered_at: string | null
          delivered_at: string | null
          custom_delivery_date: string | null
          material_id: string | null
          material_variant_id: string | null
          steel_type_id: string | null
          calculated_weight_kg: number | null
          is_custom_material_variant: boolean
          reserved_from_stock_kg: number | null
          remainder_qty: number
          source_nesting_run_id: string | null
          source_machine_item_id: string | null
          source_product_id: string | null
          source_nesting_project_id: string | null
          source_nesting_sheet_id: string | null
        }
        Insert: {
          id?: string
          request_id: string
          material_name: string
          material_grade?: string | null
          thickness_mm?: number | null
          sheet_size?: string | null
          quantity_sheets?: number
          weight_order_kg?: number
          weight_scrap_kg?: number | null
          scrap_percent?: number | null
          stock_on_hand_kg?: number | null
          stock_sheet_size?: string | null
          additional_parts_kg?: number | null
          business_scrap_kg?: number | null
          stock_parts_kg?: number | null
          supplier_id?: string | null
          sort_order?: number
          created_at?: string
          order_status?: Database['public']['Enums']['order_item_status']
          ordered_at?: string | null
          delivered_at?: string | null
          custom_delivery_date?: string | null
          material_id?: string | null
          material_variant_id?: string | null
          steel_type_id?: string | null
          calculated_weight_kg?: number | null
          is_custom_material_variant?: boolean
          reserved_from_stock_kg?: number | null
          remainder_qty?: number
          source_nesting_run_id?: string | null
          source_machine_item_id?: string | null
          source_product_id?: string | null
          source_nesting_project_id?: string | null
          source_nesting_sheet_id?: string | null
        }
        Update: {
          id?: string
          request_id?: string
          material_name?: string
          material_grade?: string | null
          thickness_mm?: number | null
          sheet_size?: string | null
          quantity_sheets?: number
          weight_order_kg?: number
          weight_scrap_kg?: number | null
          scrap_percent?: number | null
          stock_on_hand_kg?: number | null
          stock_sheet_size?: string | null
          additional_parts_kg?: number | null
          business_scrap_kg?: number | null
          stock_parts_kg?: number | null
          supplier_id?: string | null
          sort_order?: number
          created_at?: string
          order_status?: Database['public']['Enums']['order_item_status']
          ordered_at?: string | null
          delivered_at?: string | null
          custom_delivery_date?: string | null
          material_id?: string | null
          material_variant_id?: string | null
          steel_type_id?: string | null
          calculated_weight_kg?: number | null
          is_custom_material_variant?: boolean
          reserved_from_stock_kg?: number | null
          remainder_qty?: number
          source_nesting_run_id?: string | null
          source_machine_item_id?: string | null
          source_product_id?: string | null
          source_nesting_project_id?: string | null
          source_nesting_sheet_id?: string | null
        }
      }
      request_round_tube: {
        Row: {
          id: string
          request_id: string
          material_name: string
          order_meters: number
          order_kg: number
          actual_meters: number | null
          actual_kg: number | null
          piece_count: string | null
          scrap_meters: number | null
          scrap_kg: number | null
          scrap_percent: number | null
          supplier_id: string | null
          sort_order: number
          created_at: string
          order_status: Database['public']['Enums']['order_item_status']
          ordered_at: string | null
          delivered_at: string | null
          custom_delivery_date: string | null
          material_id: string | null
          material_variant_id: string | null
          reserved_from_stock_kg: number | null
          reserved_from_stock_m: number | null
        }
        Insert: {
          id?: string
          request_id: string
          material_name: string
          order_meters?: number
          order_kg?: number
          actual_meters?: number | null
          actual_kg?: number | null
          piece_count?: string | null
          supplier_id?: string | null
          sort_order?: number
          created_at?: string
          order_status?: Database['public']['Enums']['order_item_status']
          ordered_at?: string | null
          delivered_at?: string | null
          custom_delivery_date?: string | null
          material_id?: string | null
          material_variant_id?: string | null
          reserved_from_stock_kg?: number | null
          reserved_from_stock_m?: number | null
        }
        Update: {
          id?: string
          request_id?: string
          material_name?: string
          order_meters?: number
          order_kg?: number
          actual_meters?: number | null
          actual_kg?: number | null
          piece_count?: string | null
          supplier_id?: string | null
          sort_order?: number
          created_at?: string
          order_status?: Database['public']['Enums']['order_item_status']
          ordered_at?: string | null
          delivered_at?: string | null
          custom_delivery_date?: string | null
          material_id?: string | null
          material_variant_id?: string | null
          reserved_from_stock_kg?: number | null
          reserved_from_stock_m?: number | null
        }
      }
      request_knives: {
        Row: {
          id: string
          request_id: string
          knife_type: string
          order_mm: number
          will_be_used_mm: number | null
          stock_remainder_mm: number | null
          to_order_mm: number
          sort_order: number
          created_at: string
          order_status: Database['public']['Enums']['order_item_status']
          ordered_at: string | null
          delivered_at: string | null
          custom_delivery_date: string | null
          material_id: string | null
          material_variant_id: string | null
          reserved_from_stock_mm: number | null
          steel_grade: string | null
          length_mm: number | null
          width_mm: number | null
          height_mm: number | null
          steel_type_id: string | null
          calculated_weight_kg: number | null
          is_custom_material_variant: boolean
          remainder_meters: number
          remainder_qty: number
        }
        Insert: {
          id?: string
          request_id: string
          knife_type: string
          order_mm?: number
          will_be_used_mm?: number | null
          stock_remainder_mm?: number | null
          sort_order?: number
          created_at?: string
          order_status?: Database['public']['Enums']['order_item_status']
          ordered_at?: string | null
          delivered_at?: string | null
          custom_delivery_date?: string | null
          material_id?: string | null
          material_variant_id?: string | null
          reserved_from_stock_mm?: number | null
          steel_grade?: string | null
          length_mm?: number | null
          width_mm?: number | null
          height_mm?: number | null
          steel_type_id?: string | null
          calculated_weight_kg?: number | null
          is_custom_material_variant?: boolean
          remainder_meters?: number
          remainder_qty?: number
        }
        Update: {
          id?: string
          request_id?: string
          knife_type?: string
          order_mm?: number
          will_be_used_mm?: number | null
          stock_remainder_mm?: number | null
          sort_order?: number
          created_at?: string
          order_status?: Database['public']['Enums']['order_item_status']
          ordered_at?: string | null
          delivered_at?: string | null
          custom_delivery_date?: string | null
          material_id?: string | null
          material_variant_id?: string | null
          reserved_from_stock_mm?: number | null
          steel_grade?: string | null
          length_mm?: number | null
          width_mm?: number | null
          height_mm?: number | null
          steel_type_id?: string | null
          calculated_weight_kg?: number | null
          is_custom_material_variant?: boolean
          remainder_meters?: number
          remainder_qty?: number
        }
      }
      request_components: {
        Row: {
          id: string
          request_id: string
          component_name: string
          specification: string | null
          quantity_needed: number
          unit: string
          availability: string | null
          stock_remainder: number | null
          to_order: number
          sort_order: number
          created_at: string
          order_status: Database['public']['Enums']['order_item_status']
          ordered_at: string | null
          delivered_at: string | null
          custom_delivery_date: string | null
          material_id: string | null
          material_variant_id: string | null
          reserved_from_stock: number | null
          diameter_mm: number | null
          is_custom_material_variant: boolean
        }
        Insert: {
          id?: string
          request_id: string
          component_name: string
          specification?: string | null
          quantity_needed?: number
          unit?: string
          availability?: string | null
          stock_remainder?: number | null
          sort_order?: number
          created_at?: string
          order_status?: Database['public']['Enums']['order_item_status']
          ordered_at?: string | null
          delivered_at?: string | null
          custom_delivery_date?: string | null
          material_id?: string | null
          material_variant_id?: string | null
          reserved_from_stock?: number | null
          diameter_mm?: number | null
          is_custom_material_variant?: boolean
        }
        Update: {
          id?: string
          request_id?: string
          component_name?: string
          specification?: string | null
          quantity_needed?: number
          unit?: string
          availability?: string | null
          stock_remainder?: number | null
          sort_order?: number
          created_at?: string
          order_status?: Database['public']['Enums']['order_item_status']
          ordered_at?: string | null
          delivered_at?: string | null
          custom_delivery_date?: string | null
          material_id?: string | null
          material_variant_id?: string | null
          reserved_from_stock?: number | null
          diameter_mm?: number | null
          is_custom_material_variant?: boolean
        }
      }
      request_paint: {
        Row: {
          id: string
          request_id: string
          paint_type: string
          ral_code: string
          finish: string | null
          area_m2: number
          weight_kg: number
          waste_percent: number | null
          weight_with_waste_kg: number
          stock_remainder_kg: number | null
          to_order_kg: number
          sort_order: number
          created_at: string
          order_status: Database['public']['Enums']['order_item_status']
          ordered_at: string | null
          delivered_at: string | null
          custom_delivery_date: string | null
          material_id: string | null
          material_variant_id: string | null
          reserved_from_stock_kg: number | null
          remainder_kg: number
        }
        Insert: {
          id?: string
          request_id: string
          paint_type?: string
          ral_code: string
          finish?: string | null
          area_m2?: number
          weight_kg?: number
          waste_percent?: number | null
          stock_remainder_kg?: number | null
          sort_order?: number
          created_at?: string
          order_status?: Database['public']['Enums']['order_item_status']
          ordered_at?: string | null
          delivered_at?: string | null
          custom_delivery_date?: string | null
          material_id?: string | null
          material_variant_id?: string | null
          reserved_from_stock_kg?: number | null
          remainder_kg?: number
        }
        Update: {
          id?: string
          request_id?: string
          paint_type?: string
          ral_code?: string
          finish?: string | null
          area_m2?: number
          weight_kg?: number
          waste_percent?: number | null
          stock_remainder_kg?: number | null
          sort_order?: number
          created_at?: string
          order_status?: Database['public']['Enums']['order_item_status']
          ordered_at?: string | null
          delivered_at?: string | null
          custom_delivery_date?: string | null
          material_id?: string | null
          material_variant_id?: string | null
          reserved_from_stock_kg?: number | null
          remainder_kg?: number
        }
      }
      request_circle: {
        Row: {
          id: string
          request_id: string
          diameter_mm: number | null
          steel_grade: string | null
          is_calibrated: boolean
          remainder_mm: number
          material_id: string | null
          material_variant_id: string | null
          custom_delivery_date: string | null
          order_status: Database['public']['Enums']['order_item_status']
          ordered_at: string | null
          delivered_at: string | null
          reserved_from_stock_mm: number
          steel_type_id: string | null
          calculated_weight_kg: number | null
          is_custom_material_variant: boolean
          sort_order: number
          created_at: string
        }
        Insert: {
          id?: string
          request_id: string
          diameter_mm?: number | null
          steel_grade?: string | null
          is_calibrated?: boolean
          remainder_mm?: number
          material_id?: string | null
          material_variant_id?: string | null
          custom_delivery_date?: string | null
          order_status?: Database['public']['Enums']['order_item_status']
          ordered_at?: string | null
          delivered_at?: string | null
          reserved_from_stock_mm?: number
          steel_type_id?: string | null
          calculated_weight_kg?: number | null
          is_custom_material_variant?: boolean
          sort_order?: number
          created_at?: string
        }
        Update: {
          id?: string
          request_id?: string
          diameter_mm?: number | null
          steel_grade?: string | null
          is_calibrated?: boolean
          remainder_mm?: number
          material_id?: string | null
          material_variant_id?: string | null
          custom_delivery_date?: string | null
          order_status?: Database['public']['Enums']['order_item_status']
          ordered_at?: string | null
          delivered_at?: string | null
          reserved_from_stock_mm?: number
          steel_type_id?: string | null
          calculated_weight_kg?: number | null
          is_custom_material_variant?: boolean
          sort_order?: number
          created_at?: string
        }
      }
      request_pipe: {
        Row: {
          id: string
          request_id: string
          pipe_type: Database['public']['Enums']['pipe_subtype']
          size: string | null
          wall_thickness_mm: number | null
          diameter_mm: number | null
          remainder_length_mm: number
          remainder_qty: number
          remainder_kg: number
          material_id: string | null
          material_variant_id: string | null
          custom_delivery_date: string | null
          order_status: Database['public']['Enums']['order_item_status']
          ordered_at: string | null
          delivered_at: string | null
          reserved_from_stock_length_mm: number
          reserved_from_stock_qty: number
          reserved_from_stock_kg: number
          steel_type_id: string | null
          calculated_weight_kg: number | null
          is_custom_material_variant: boolean
          sort_order: number
          created_at: string
        }
        Insert: {
          id?: string
          request_id: string
          pipe_type: Database['public']['Enums']['pipe_subtype']
          size?: string | null
          wall_thickness_mm?: number | null
          diameter_mm?: number | null
          remainder_length_mm?: number
          remainder_qty?: number
          remainder_kg?: number
          material_id?: string | null
          material_variant_id?: string | null
          custom_delivery_date?: string | null
          order_status?: Database['public']['Enums']['order_item_status']
          ordered_at?: string | null
          delivered_at?: string | null
          reserved_from_stock_length_mm?: number
          reserved_from_stock_qty?: number
          reserved_from_stock_kg?: number
          steel_type_id?: string | null
          calculated_weight_kg?: number | null
          is_custom_material_variant?: boolean
          sort_order?: number
          created_at?: string
        }
        Update: {
          id?: string
          request_id?: string
          pipe_type?: Database['public']['Enums']['pipe_subtype']
          size?: string | null
          wall_thickness_mm?: number | null
          diameter_mm?: number | null
          remainder_length_mm?: number
          remainder_qty?: number
          remainder_kg?: number
          material_id?: string | null
          material_variant_id?: string | null
          custom_delivery_date?: string | null
          order_status?: Database['public']['Enums']['order_item_status']
          ordered_at?: string | null
          delivered_at?: string | null
          reserved_from_stock_length_mm?: number
          reserved_from_stock_qty?: number
          reserved_from_stock_kg?: number
          steel_type_id?: string | null
          calculated_weight_kg?: number | null
          is_custom_material_variant?: boolean
          sort_order?: number
          created_at?: string
        }
      }
      request_mesh: {
        Row: {
          id: string
          request_id: string
          description: string | null
          length_mm: number | null
          width_mm: number | null
          remainder_qty: number
          material_id: string | null
          material_variant_id: string | null
          custom_delivery_date: string | null
          order_status: Database['public']['Enums']['order_item_status']
          ordered_at: string | null
          delivered_at: string | null
          reserved_from_stock_qty: number
          sort_order: number
          created_at: string
        }
        Insert: {
          id?: string
          request_id: string
          description?: string | null
          length_mm?: number | null
          width_mm?: number | null
          remainder_qty?: number
          material_id?: string | null
          material_variant_id?: string | null
          custom_delivery_date?: string | null
          order_status?: Database['public']['Enums']['order_item_status']
          ordered_at?: string | null
          delivered_at?: string | null
          reserved_from_stock_qty?: number
          sort_order?: number
          created_at?: string
        }
        Update: {
          id?: string
          request_id?: string
          description?: string | null
          length_mm?: number | null
          width_mm?: number | null
          remainder_qty?: number
          material_id?: string | null
          material_variant_id?: string | null
          custom_delivery_date?: string | null
          order_status?: Database['public']['Enums']['order_item_status']
          ordered_at?: string | null
          delivered_at?: string | null
          reserved_from_stock_qty?: number
          sort_order?: number
          created_at?: string
        }
      }
      request_chain_cord: {
        Row: {
          id: string
          request_id: string
          item_type: Database['public']['Enums']['chain_cord_subtype']
          parameters: string | null
          remainder_meters: number
          material_id: string | null
          material_variant_id: string | null
          custom_delivery_date: string | null
          order_status: Database['public']['Enums']['order_item_status']
          ordered_at: string | null
          delivered_at: string | null
          reserved_from_stock_meters: number
          sort_order: number
          created_at: string
        }
        Insert: {
          id?: string
          request_id: string
          item_type: Database['public']['Enums']['chain_cord_subtype']
          parameters?: string | null
          remainder_meters?: number
          material_id?: string | null
          material_variant_id?: string | null
          custom_delivery_date?: string | null
          order_status?: Database['public']['Enums']['order_item_status']
          ordered_at?: string | null
          delivered_at?: string | null
          reserved_from_stock_meters?: number
          sort_order?: number
          created_at?: string
        }
        Update: {
          id?: string
          request_id?: string
          item_type?: Database['public']['Enums']['chain_cord_subtype']
          parameters?: string | null
          remainder_meters?: number
          material_id?: string | null
          material_variant_id?: string | null
          custom_delivery_date?: string | null
          order_status?: Database['public']['Enums']['order_item_status']
          ordered_at?: string | null
          delivered_at?: string | null
          reserved_from_stock_meters?: number
          sort_order?: number
          created_at?: string
        }
      }
    }
    Views: {
      consumable_stock_overview: {
        Row: {
          consumable_id: string
          factory_id: string
          category_id: string
          category_name: string
          name: string
          characteristics: string
          article: string
          unit: string
          minimum_quantity: number
          is_active: boolean
          current_quantity: number
          in_work_quantity: number
          is_below_minimum: boolean
          shortage_quantity: number
          updated_at: string | null
        }
      }
      machines_with_totals: {
        Row: {
          id: string
          factory_id: string | null
          created_by: string
          name: string
          created_at: string
          updated_at: string
          desired_shipping_date: string | null
          is_confirmed: boolean
          planned_material_date: string | null
          actual_material_date: string | null
          actual_shipping_date: string | null
          delivery_to_client_date: string | null
          production_month: string | null
          production_workshop: number | null
          production_queue_number: number | null
          client_id: string | null
          contract_id: string | null
          specification_number: string | null
          specification_date: string | null
          freight_cost: number | null
          payment_terms_type: Database['public']['Enums']['payment_terms_type']
          payment_due_days: number
          prepayment_percent: number | null
          final_payment_due_days: number | null
          is_archived: boolean
          archived_at: string | null
          archived_by: string | null
          archive_reason: string | null
          total_weight: number
          total_items_cost: number
          total_expenses: number
          total_cost: number
          item_count: number
          has_zinc: boolean
          has_painting: boolean
          status: Database['public']['Enums']['machine_status']
          material_type: Database['public']['Enums']['material_type']
        }
      }
      supply_items_with_overdue: {
        Row: {
          id: string
          machine_id: string
          nomenclature: string | null
          unit: string | null
          quantity: number | null
          supplier: string | null
          price_per_unit: number | null
          status: Database['public']['Enums']['supply_status']
          comment: string | null
          planned_delivery_date: string | null
          engineer_confirmation: boolean
          engineer_deadline: string | null
          technologist_deadline: string | null
          created_at: string
          updated_at: string
          days_overdue: number | null
        }
      }
      production_stages_with_delay: {
        Row: {
          id: string
          machine_id: string
          stage_type: Database['public']['Enums']['stage_type']
          workshop: number | null
          date_start: string | null
          date_end: string | null
          planned_date_end: string | null
          manual_overdue: boolean
          is_skipped: boolean
          is_night_shift: boolean
          night_shift_date: string | null
          created_at: string
          updated_at: string
          delay_days: number | null
          is_overdue: boolean
        }
      }
    }
    Enums: {
      user_role:
        | 'financial_director'
        | 'commercial_director'
        | 'planning_director'
        | 'sales_manager'
        | 'engineer'
        | 'technologist'
        | 'supply_manager'
        | 'production_manager'
        | 'procurement_head'
        | 'painting_head'
      coating_type: 'zinc' | 'powder_coating' | 'none'
      stage_type:
        | 'cutting'
        | 'assembly'
          | 'cleaning'
          | 'galvanizing'
          | 'post_galvanizing_cleaning'
          | 'painting'
          | 'packaging'
          | 'shipping'
          | 'actual_shipping'
      supply_status: 'received' | 'ordered' | 'not_ordered'
      invoice_status: 'paid' | 'not_paid' | 'overdue'
      payment_terms_type: 'invoice_days' | 'delivery_days' | 'prepayment_full'
      production_fact_shift: 'day' | 'night'
      machine_status:
        | 'created'
        | 'under_review'
        | 'factory_assigned'
        | 'in_production'
        | 'shipped'
        | 'confirmed'
        | 'planned'
        | 'request_ready'
        | 'purchasing'
        | 'material_received'
      material_type: 'standard' | 'non_standard' | 'undefined'
      meeting_type: string
      meeting_status: 'planned' | 'completed' | 'cancelled'
      material_category: 'sheet_metal' | 'round_tube' | 'knives' | 'components' | 'paint' | 'other' | 'circle' | 'pipe' | 'mesh' | 'chain_cord'
      pipe_subtype: 'square' | 'rectangular' | 'round' | 'wire'
      chain_cord_subtype: 'chain' | 'cord'
      task_delegation_status: 'pending' | 'accepted' | 'declined' | 'cancelled'
      production_month_plan_status: 'draft' | 'preliminary_ready' | 'confirmed'
      production_date_change_request_status: 'pending' | 'approved' | 'rejected' | 'conflicted'
      task_type: 'supply_start' | 'technologist_request' | 'engineer_confirm' | 'agenda_pool_distribution' | 'meeting_unresolved_agenda' | 'meeting_action_item' | 'machine_review' | 'technologist_request_exception' | 'transport_cost' | 'product_project_engineering' | 'product_project_sales_review' | 'consumable_request_review' | 'consumable_request_shortage' | 'supply_material_receipt_shortage' | 'production_cutting_rollback_review' | 'production_plan_date_change_approval'
      task_status: 'pending' | 'in_progress' | 'completed' | 'cancelled'
      consumable_request_priority: 'standard' | 'high'
      consumable_request_status: 'draft' | 'new' | 'invoice_taken' | 'delivery' | 'received' | 'received_partial' | 'cancelled'
      consumable_delivery_method: 'nova_poshta' | 'other'
      consumable_movement_type: 'initial' | 'manual_receipt' | 'request_receipt' | 'consumption' | 'adjustment'
      request_status: 'draft' | 'pending_stock_check' | 'stock_checked' | 'submitted_to_supply' | 'completed'
      order_item_status: 'pending' | 'ordered' | 'delivered'
      inventory_transaction_type: 'receipt' | 'reserve' | 'unreserve' | 'write_off' | 'adjustment'
    }
    Functions: {
      create_consumable_item: {
        Args: {
          p_factory_id: string
          p_category_id: string
          p_name: string
          p_characteristics: string
          p_article: string
          p_unit: string
          p_minimum_quantity: number
          p_initial_quantity: number
        }
        Returns: string
      }
      record_consumable_stock_operation: {
        Args: {
          p_consumable_id: string
          p_operation: Database['public']['Enums']['consumable_movement_type']
          p_quantity: number
          p_comment?: string | null
          p_new_balance?: number | null
        }
        Returns: number
      }
      sync_consumable_auto_draft: {
        Args: { p_consumable_id: string }
        Returns: undefined
      }
      submit_consumable_request: {
        Args: {
          p_request_id: string
          p_priority: Database['public']['Enums']['consumable_request_priority']
        }
        Returns: undefined
      }
      transition_consumable_request_supply: {
        Args: {
          p_request_id: string
          p_new_status: Database['public']['Enums']['consumable_request_status']
          p_delivery_method?: Database['public']['Enums']['consumable_delivery_method'] | null
          p_nova_poshta_ttn?: string | null
          p_carrier_name?: string | null
          p_carrier_eta?: string | null
        }
        Returns: undefined
      }
      update_consumable_other_delivery_eta: {
        Args: { p_request_id: string; p_carrier_eta: string }
        Returns: undefined
      }
      receive_consumable_request: {
        Args: { p_request_id: string; p_quantity: number }
        Returns: undefined
      }
      close_consumable_request_remainder: {
        Args: { p_request_id: string; p_reason: string }
        Returns: undefined
      }
      cancel_consumable_request: {
        Args: { p_request_id: string; p_reason: string }
        Returns: undefined
      }
      accept_task_delegation: {
        Args: {
          p_delegation_id: string
          p_user_id: string
        }
        Returns: {
          task_id: string
          machine_id: string | null
          product_project_id: string | null
          delegated_by: string
          delegated_to: string
          task_title: string
        }[]
      }
      fn_refresh_meeting_agenda_pool: {
        Args: Record<string, never>
        Returns: number
      }
      fn_create_agenda_pool_distribution_tasks: {
        Args: Record<string, never>
        Returns: number
      }
      notify_users_by_role: {
        Args: {
          p_role: Database['public']['Enums']['user_role']
          p_type: string
          p_title: string
          p_message: string
          p_machine_id?: string | null
        }
        Returns: void
      }
      notify_users_by_role_in_factory: {
        Args: {
          p_factory_id: string
          p_role: Database['public']['Enums']['user_role']
          p_type: string
          p_title: string
          p_message: string
          p_machine_id?: string | null
        }
        Returns: void
      }
      fn_adjust_inventory: {
        Args: {
          p_material_id: string
          p_new_total: number
          p_performed_by: string
          p_comment: string
          p_new_secondary_total?: number | null
        }
        Returns: void
      }
      fn_adjust_inventory_record: {
        Args: {
          p_inventory_id: string
          p_new_total: number
          p_performed_by: string
          p_comment: string
          p_new_secondary_total?: number | null
        }
        Returns: void
      }
      fn_add_inventory_receipt: {
        Args: {
          p_material_id: string
          p_quantity: number
          p_unit: string
          p_performed_by: string
          p_comment?: string | null
          p_secondary_quantity?: number | null
          p_secondary_unit?: string | null
          p_supplier_id?: string | null
          p_material_variant_id?: string | null
          p_piece_length_mm?: number | null
          p_factory_id?: string | null
        }
        Returns: string
      }
      fn_archive_inventory_item: {
        Args: {
          p_inventory_id: string
          p_performed_by: string
          p_comment?: string | null
        }
        Returns: void
      }
      fn_reserve_inventory_for_machine: {
        Args: {
          p_material_id: string
          p_machine_id: string
          p_quantity: number
          p_request_item_table: string
          p_request_item_id: string
          p_reserved_by: string
          p_secondary_quantity?: number | null
          p_material_variant_id?: string | null
          p_piece_length_mm?: number | null
        }
        Returns: string
      }
      fn_unreserve_inventory_reservation: {
        Args: {
          p_reservation_id: string
          p_performed_by: string
          p_comment?: string | null
        }
        Returns: void
      }
      fn_apply_production_fact_cutting: {
        Args: {
          p_fact_id: string
          p_performed_by: string
        }
        Returns: string | null
      }
      fn_get_production_cutting_rollback_preview: {
        Args: {
          p_machine_id: string
        }
        Returns: Json
      }
      fn_apply_production_cutting_rollback: {
        Args: {
          p_machine_id: string
          p_task_id: string | null
          p_performed_by: string
          p_comment?: string | null
        }
        Returns: Json
      }
      fn_keep_production_cutting_rollback: {
        Args: {
          p_machine_id: string
          p_task_id: string | null
          p_performed_by: string
          p_comment?: string | null
        }
        Returns: Json
      }
      get_user_role: {
        Args: Record<string, never>
        Returns: Database['public']['Enums']['user_role']
      }
      get_user_factory_id: {
        Args: Record<string, never>
        Returns: string
      }
      is_director: {
        Args: Record<string, never>
        Returns: boolean
      }
    }
  }
}
