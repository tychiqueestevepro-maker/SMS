export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      billing_period_usage: {
        Row: {
          actual_outbound_segments: number
          billing_period_id: string
          created_at: string
          next_usage_position: number
          reserved_outbound_segments: number
          updated_at: string
          workspace_id: string
        }
        Insert: {
          actual_outbound_segments?: number
          billing_period_id: string
          created_at?: string
          next_usage_position?: number
          reserved_outbound_segments?: number
          updated_at?: string
          workspace_id: string
        }
        Update: {
          actual_outbound_segments?: number
          billing_period_id?: string
          created_at?: string
          next_usage_position?: number
          reserved_outbound_segments?: number
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "billing_period_usage_period_fkey"
            columns: ["workspace_id", "billing_period_id"]
            isOneToOne: false
            referencedRelation: "billing_periods"
            referencedColumns: ["workspace_id", "id"]
          },
        ]
      }
      billing_periods: {
        Row: {
          billing_plan_id: string
          created_at: string
          id: string
          included_segments_snapshot: number
          is_provisional: boolean
          max_phone_numbers_snapshot: number
          monthly_price_cents_snapshot: number
          overage_price_micro_usd_snapshot: number
          period_end: string
          period_start: string
          safety_cap_segments_snapshot: number
          status: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          billing_plan_id: string
          created_at?: string
          id?: string
          included_segments_snapshot: number
          is_provisional?: boolean
          max_phone_numbers_snapshot: number
          monthly_price_cents_snapshot: number
          overage_price_micro_usd_snapshot: number
          period_end: string
          period_start: string
          safety_cap_segments_snapshot: number
          status?: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          billing_plan_id?: string
          created_at?: string
          id?: string
          included_segments_snapshot?: number
          is_provisional?: boolean
          max_phone_numbers_snapshot?: number
          monthly_price_cents_snapshot?: number
          overage_price_micro_usd_snapshot?: number
          period_end?: string
          period_start?: string
          safety_cap_segments_snapshot?: number
          status?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "billing_periods_billing_plan_id_fkey"
            columns: ["billing_plan_id"]
            isOneToOne: false
            referencedRelation: "billing_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_periods_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_plans: {
        Row: {
          code: string
          created_at: string
          id: string
          included_segments: number
          is_active: boolean
          large_campaign_overage_credit_threshold: number
          large_campaign_recipient_threshold: number
          max_phone_numbers: number
          monthly_price_cents: number
          name: string
          overage_price_micro_usd: number
          safety_cap_segments: number
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          id?: string
          included_segments: number
          is_active?: boolean
          large_campaign_overage_credit_threshold?: number
          large_campaign_recipient_threshold?: number
          max_phone_numbers: number
          monthly_price_cents: number
          name: string
          overage_price_micro_usd: number
          safety_cap_segments: number
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          id?: string
          included_segments?: number
          is_active?: boolean
          large_campaign_overage_credit_threshold?: number
          large_campaign_recipient_threshold?: number
          max_phone_numbers?: number
          monthly_price_cents?: number
          name?: string
          overage_price_micro_usd?: number
          safety_cap_segments?: number
          updated_at?: string
        }
        Relationships: []
      }
      campaign_draft_contacts: {
        Row: {
          campaign_id: string
          contact_id: string
          created_at: string
        }
        Insert: {
          campaign_id: string
          contact_id: string
          created_at?: string
        }
        Update: {
          campaign_id?: string
          contact_id?: string
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaign_draft_contacts_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_draft_contacts_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_recipients: {
        Row: {
          campaign_id: string
          contact_id: string
          created_at: string
          current_step_order: number
          enrolled_at: string
          finished_at: string | null
          id: string
          next_send_at: string | null
          replied_at: string | null
          state: string
          stop_reason: string | null
          stopped_at: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          campaign_id: string
          contact_id: string
          created_at?: string
          current_step_order?: number
          enrolled_at?: string
          finished_at?: string | null
          id?: string
          next_send_at?: string | null
          replied_at?: string | null
          state?: string
          stop_reason?: string | null
          stopped_at?: string | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          campaign_id?: string
          contact_id?: string
          created_at?: string
          current_step_order?: number
          enrolled_at?: string
          finished_at?: string | null
          id?: string
          next_send_at?: string | null
          replied_at?: string | null
          state?: string
          stop_reason?: string | null
          stopped_at?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaign_recipients_workspace_campaign_fkey"
            columns: ["workspace_id", "campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["workspace_id", "id"]
          },
          {
            foreignKeyName: "campaign_recipients_workspace_contact_fkey"
            columns: ["workspace_id", "contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["workspace_id", "id"]
          },
        ]
      }
      campaign_steps: {
        Row: {
          body: string
          campaign_id: string
          created_at: string
          id: string
          step_order: number
          updated_at: string
          wait_days_after_previous: number
        }
        Insert: {
          body: string
          campaign_id: string
          created_at?: string
          id?: string
          step_order: number
          updated_at?: string
          wait_days_after_previous: number
        }
        Update: {
          body?: string
          campaign_id?: string
          created_at?: string
          id?: string
          step_order?: number
          updated_at?: string
          wait_days_after_previous?: number
        }
        Relationships: [
          {
            foreignKeyName: "campaign_steps_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      campaigns: {
        Row: {
          created_at: string
          deleted_at: string | null
          drip_interval_minutes: number
          finished_at: string | null
          id: string
          launched_at: string | null
          name: string
          paused_at: string | null
          phone_number_id: string | null
          send_window_end: string
          send_window_start: string
          sending_days: number[]
          status: string
          timezone: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          drip_interval_minutes?: number
          finished_at?: string | null
          id?: string
          launched_at?: string | null
          name: string
          paused_at?: string | null
          phone_number_id?: string | null
          send_window_end?: string
          send_window_start?: string
          sending_days?: number[]
          status?: string
          timezone?: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          drip_interval_minutes?: number
          finished_at?: string | null
          id?: string
          launched_at?: string | null
          name?: string
          paused_at?: string | null
          phone_number_id?: string | null
          send_window_end?: string
          send_window_start?: string
          sending_days?: number[]
          status?: string
          timezone?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaigns_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaigns_workspace_phone_number_fkey"
            columns: ["workspace_id", "phone_number_id"]
            isOneToOne: false
            referencedRelation: "phone_numbers"
            referencedColumns: ["workspace_id", "id"]
          },
        ]
      }
      consent_confirmations: {
        Row: {
          campaign_id: string
          confirmed_at: string
          confirmed_by: string
          consent_confirmed: boolean
          id: string
          large_launch_confirmed: boolean
          launch_assessment: Json
          recipient_count: number
          workspace_id: string
        }
        Insert: {
          campaign_id: string
          confirmed_at?: string
          confirmed_by: string
          consent_confirmed: boolean
          id?: string
          large_launch_confirmed: boolean
          launch_assessment: Json
          recipient_count: number
          workspace_id: string
        }
        Update: {
          campaign_id?: string
          confirmed_at?: string
          confirmed_by?: string
          consent_confirmed?: boolean
          id?: string
          large_launch_confirmed?: boolean
          launch_assessment?: Json
          recipient_count?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "consent_confirmations_workspace_campaign_fkey"
            columns: ["workspace_id", "campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["workspace_id", "id"]
          },
        ]
      }
      contacts: {
        Row: {
          company: string
          country_code: string
          created_at: string
          deleted_at: string | null
          first_name: string
          has_unread_messages: boolean
          id: string
          job_title: string | null
          last_contacted_at: string | null
          last_name: string
          last_replied_at: string | null
          notes: string
          phone_e164: string
          pipeline_stage_id: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          company?: string
          country_code: string
          created_at?: string
          deleted_at?: string | null
          first_name?: string
          has_unread_messages?: boolean
          id?: string
          job_title?: string | null
          last_contacted_at?: string | null
          last_name?: string
          last_replied_at?: string | null
          notes?: string
          phone_e164: string
          pipeline_stage_id: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          company?: string
          country_code?: string
          created_at?: string
          deleted_at?: string | null
          first_name?: string
          has_unread_messages?: boolean
          id?: string
          job_title?: string | null
          last_contacted_at?: string | null
          last_name?: string
          last_replied_at?: string | null
          notes?: string
          phone_e164?: string
          pipeline_stage_id?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "contacts_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contacts_workspace_pipeline_stage_fkey"
            columns: ["workspace_id", "pipeline_stage_id"]
            isOneToOne: false
            referencedRelation: "pipeline_stages"
            referencedColumns: ["workspace_id", "id"]
          },
        ]
      }
      messages: {
        Row: {
          accepted_at: string | null
          billing_period_id: string | null
          body: string
          campaign_id: string | null
          campaign_recipient_id: string | null
          contact_id: string
          created_at: string
          delivery_state: string | null
          direction: string
          dispatch_started_at: string | null
          dispatch_state: string
          estimated_segments: number | null
          failed_at: string | null
          failure_code: string | null
          id: string
          in_reply_to_message_id: string | null
          included_segments_snapshot: number | null
          num_segments: number | null
          overage_price_micro_usd_snapshot: number | null
          phone_number_id: string
          received_at: string | null
          reservation_released_at: string | null
          reservation_token: string | null
          reserved_at: string | null
          reserved_billing_period_id: string | null
          reserved_segments: number
          scheduled_for: string | null
          sent_at: string | null
          step_order: number | null
          updated_at: string
          usage_position: number | null
          workspace_id: string
        }
        Insert: {
          accepted_at?: string | null
          billing_period_id?: string | null
          body: string
          campaign_id?: string | null
          campaign_recipient_id?: string | null
          contact_id: string
          created_at?: string
          delivery_state?: string | null
          direction: string
          dispatch_started_at?: string | null
          dispatch_state?: string
          estimated_segments?: number | null
          failed_at?: string | null
          failure_code?: string | null
          id?: string
          in_reply_to_message_id?: string | null
          included_segments_snapshot?: number | null
          num_segments?: number | null
          overage_price_micro_usd_snapshot?: number | null
          phone_number_id: string
          received_at?: string | null
          reservation_released_at?: string | null
          reservation_token?: string | null
          reserved_at?: string | null
          reserved_billing_period_id?: string | null
          reserved_segments?: number
          scheduled_for?: string | null
          sent_at?: string | null
          step_order?: number | null
          updated_at?: string
          usage_position?: number | null
          workspace_id: string
        }
        Update: {
          accepted_at?: string | null
          billing_period_id?: string | null
          body?: string
          campaign_id?: string | null
          campaign_recipient_id?: string | null
          contact_id?: string
          created_at?: string
          delivery_state?: string | null
          direction?: string
          dispatch_started_at?: string | null
          dispatch_state?: string
          estimated_segments?: number | null
          failed_at?: string | null
          failure_code?: string | null
          id?: string
          in_reply_to_message_id?: string | null
          included_segments_snapshot?: number | null
          num_segments?: number | null
          overage_price_micro_usd_snapshot?: number | null
          phone_number_id?: string
          received_at?: string | null
          reservation_released_at?: string | null
          reservation_token?: string | null
          reserved_at?: string | null
          reserved_billing_period_id?: string | null
          reserved_segments?: number
          scheduled_for?: string | null
          sent_at?: string | null
          step_order?: number | null
          updated_at?: string
          usage_position?: number | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_billing_period_fkey"
            columns: ["workspace_id", "billing_period_id"]
            isOneToOne: false
            referencedRelation: "billing_periods"
            referencedColumns: ["workspace_id", "id"]
          },
          {
            foreignKeyName: "messages_in_reply_to_fkey"
            columns: ["workspace_id", "in_reply_to_message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["workspace_id", "id"]
          },
          {
            foreignKeyName: "messages_reserved_period_fkey"
            columns: ["workspace_id", "reserved_billing_period_id"]
            isOneToOne: false
            referencedRelation: "billing_periods"
            referencedColumns: ["workspace_id", "id"]
          },
          {
            foreignKeyName: "messages_workspace_campaign_fkey"
            columns: ["workspace_id", "campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["workspace_id", "id"]
          },
          {
            foreignKeyName: "messages_workspace_contact_fkey"
            columns: ["workspace_id", "contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["workspace_id", "id"]
          },
          {
            foreignKeyName: "messages_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_workspace_phone_fkey"
            columns: ["workspace_id", "phone_number_id"]
            isOneToOne: false
            referencedRelation: "phone_numbers"
            referencedColumns: ["workspace_id", "id"]
          },
          {
            foreignKeyName: "messages_workspace_recipient_fkey"
            columns: ["workspace_id", "campaign_recipient_id"]
            isOneToOne: false
            referencedRelation: "campaign_recipients"
            referencedColumns: ["workspace_id", "id"]
          },
        ]
      }
      phone_numbers: {
        Row: {
          activated_at: string | null
          country_code: string
          created_at: string
          deleted_at: string | null
          id: string
          import_status: string | null
          number_source: string
          phone_e164: string | null
          status: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          activated_at?: string | null
          country_code: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          import_status?: string | null
          number_source?: string
          phone_e164?: string | null
          status?: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          activated_at?: string | null
          country_code?: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          import_status?: string | null
          number_source?: string
          phone_e164?: string | null
          status?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "phone_numbers_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      pipeline_stages: {
        Row: {
          created_at: string
          id: string
          is_default: boolean
          name: string
          position: number
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_default?: boolean
          name: string
          position: number
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_default?: boolean
          name?: string
          position?: number
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pipeline_stages_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string | null
          email: string | null
          id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          email?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          email?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      suppressions: {
        Row: {
          created_at: string
          phone_e164: string
          source: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          phone_e164: string
          source?: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          phone_e164?: string
          source?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "suppressions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspaces: {
        Row: {
          billing_plan_id: string
          created_at: string
          id: string
          name: string
          owner_id: string
          send_window_end: string
          send_window_start: string
          timezone: string
          updated_at: string
        }
        Insert: {
          billing_plan_id: string
          created_at?: string
          id?: string
          name?: string
          owner_id: string
          send_window_end?: string
          send_window_start?: string
          timezone?: string
          updated_at?: string
        }
        Update: {
          billing_plan_id?: string
          created_at?: string
          id?: string
          name?: string
          owner_id?: string
          send_window_end?: string
          send_window_start?: string
          timezone?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspaces_billing_plan_id_fkey"
            columns: ["billing_plan_id"]
            isOneToOne: false
            referencedRelation: "billing_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspaces_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      claim_automatic_number_activation: {
        Args: {
          p_number_id: string
          p_requested_at: string
          p_workspace_id: string
        }
        Returns: {
          activation_id: string
          disposition: string
          number_id: string
          workspace_id: string
        }[]
      }
      complete_automatic_number_activation: {
        Args: {
          p_activation_id: string
          p_completed_at: string
          p_number_id: string
          p_period_end: string
          p_period_start: string
          p_subscription_id: string
          p_workspace_id: string
        }
        Returns: {
          activated: boolean
          activation_id: string
          number_id: string
          product_status: string
          workspace_id: string
        }[]
      }
      fail_automatic_number_activation: {
        Args: {
          p_activation_id: string
          p_failed_at: string
          p_failure_code: string
          p_number_id: string
          p_workspace_id: string
        }
        Returns: {
          activation_id: string
          number_id: string
          recorded: boolean
          workspace_id: string
        }[]
      }
      admin_claim_approved_number_activation: {
        Args: {
          p_admin_user_id: string
          p_number_id: string
          p_requested_at: string
        }
        Returns: {
          activation_id: string
          disposition: string
          number_id: string
          workspace_id: string
        }[]
      }
      admin_complete_approved_number_activation: {
        Args: {
          p_activation_id: string
          p_admin_user_id: string
          p_completed_at: string
          p_number_id: string
          p_period_end: string
          p_period_start: string
          p_subscription_id: string
          p_workspace_id: string
        }
        Returns: {
          activated: boolean
          activation_id: string
          number_id: string
          product_status: string
          workspace_id: string
        }[]
      }
      admin_confirm_workspace_advanced_opt_out: {
        Args: {
          p_admin_user_id: string
          p_confirmed_at: string
          p_workspace_id: string
        }
        Returns: {
          confirmed: boolean
          workspace_id: string
        }[]
      }
      admin_fail_approved_number_activation: {
        Args: {
          p_activation_id: string
          p_admin_user_id: string
          p_failed_at: string
          p_failure_code: string
          p_number_id: string
          p_workspace_id: string
        }
        Returns: {
          activation_id: string
          number_id: string
          recorded: boolean
          workspace_id: string
        }[]
      }
      admin_get_billing_operations: {
        Args: { p_limit?: number }
        Returns: {
          actual_outbound_segments: number
          billed_amount_micro_usd: number
          included_segments: number
          invoice_id: string
          invoice_run_id: string
          invoice_status: string
          overage_amount_micro_usd: number
          overage_segments: number
          period_end: string
          period_id: string
          period_start: string
          period_status: string
          provider_cost_micro_usd: number
          provider_fixed_cost_micro_usd: number
          provider_message_cost_micro_usd: number
          reconciliation_status: string
          reserved_outbound_segments: number
          safety_cap_segments: number
          subscription_id: string
          workspace_id: string
          workspace_name: string
        }[]
      }
      admin_get_customers: {
        Args: { p_limit?: number }
        Returns: {
          actual_credits: number
          created_at: string
          included_credits: number
          messaging_enabled: boolean
          owner_email: string
          owner_name: string
          payment_method_status: string
          pending_phone_count: number
          phone_count: number
          reserved_credits: number
          safety_cap_credits: number
          subscription_status: string
          suspension_reason: string
          workspace_id: string
          workspace_name: string
        }[]
      }
      admin_get_message_operations: {
        Args: { p_limit?: number }
        Returns: {
          accepted_at: string
          created_at: string
          delivery_state: string
          direction: string
          dispatch_state: string
          message_id: string
          num_segments: number
          provider: string
          provider_cost_micro_usd: number
          provider_currency: string
          provider_error_code: string
          provider_error_message: string
          provider_message_id: string
          provider_status: string
          reconciliation_reason: string
          workspace_id: string
          workspace_name: string
        }[]
      }
      admin_get_number_operations: {
        Args: { p_limit?: number }
        Returns: {
          a2p_state: string
          account_sid: string
          activation_eligible: boolean
          advanced_opt_out_confirmed: boolean
          messaging_service_sid: string
          number_id: string
          phone_number: string
          product_status: string
          provider: string
          provider_error_code: string
          provider_error_message: string
          provider_number_id: string
          provider_status: string
          setup_state: string
          updated_at: string
          workspace_id: string
          workspace_name: string
        }[]
      }
      admin_record_phone_number_setup_state: {
        Args: {
          p_a2p_state: string
          p_admin_user_id: string
          p_changed_at: string
          p_next_state: string
          p_phone_number_id: string
          p_provider_error_code: string
          p_provider_error_message: string
          p_provider_status: string
          p_workspace_id: string
        }
        Returns: {
          activation_eligible: boolean
          number_id: string
          recorded: boolean
          setup_state: string
          workspace_id: string
        }[]
      }
      admin_resolve_dispatch_unknown_not_sent: {
        Args: {
          p_admin_user_id: string
          p_message_id: string
          p_resolution_note: string
          p_resolved_at: string
          p_workspace_id: string
        }
        Returns: {
          dispatch_state: string
          message_id: string
          resolved: boolean
          workspace_id: string
        }[]
      }
      admin_resolve_dispatch_unknown_sent: {
        Args: {
          p_accepted_at: string
          p_admin_user_id: string
          p_message_id: string
          p_provider: string
          p_provider_message_id: string
          p_resolution_note: string
          p_resolved_at: string
          p_workspace_id: string
        }
        Returns: {
          dispatch_state: string
          message_id: string
          resolved: boolean
          workspace_id: string
        }[]
      }
      admin_set_workspace_safety_cap: {
        Args: { p_safety_cap_credits: number; p_workspace_id: string }
        Returns: {
          safety_cap_credits: number
          workspace_id: string
        }[]
      }
      apply_verified_sms_webhook_event: {
        Args: { p_mutation: Json }
        Returns: Json
      }
      assess_campaign_launch: { Args: { p_campaign_id: string }; Returns: Json }
      campaign_failed_message_retry_summary: {
        Args: { p_campaign_id: string }
        Returns: Json
      }
      billing_apply_lifecycle_event: {
        Args: {
          p_allow_terminal_reactivation: boolean
          p_cancel_at_period_end: boolean
          p_claim_token: string
          p_customer_id: string
          p_event_id: string
          p_event_kind: string
          p_event_occurred_at: string
          p_grace_ends_at: string
          p_invoice_id: string
          p_period_end: string
          p_period_start: string
          p_status: string
          p_subscription_id: string
          p_workspace_id_hint: string
        }
        Returns: {
          event_id: string
          subscription_id: string
          workspace_id: string
        }[]
      }
      billing_apply_payment_method_event: {
        Args: {
          p_claim_token: string
          p_customer_id: string
          p_event_id: string
          p_occurred_at: string
          p_payment_method_id: string
          p_setup_intent_id: string
          p_workspace_id_hint: string
        }
        Returns: {
          customer_id: string
          event_id: string
          payment_method_id: string
          workspace_id: string
        }[]
      }
      billing_claim_payment_setup_attempt: {
        Args: {
          p_request_id: string
          p_requested_at: string
          p_workspace_id: string
        }
        Returns: {
          allowed: boolean
          replayed: boolean
          retry_after_seconds: number
        }[]
      }
      billing_claim_webhook_event: {
        Args: {
          p_event_created_at: string
          p_event_id: string
          p_event_type: string
          p_received_at: string
        }
        Returns: {
          claim_state: string
          claim_token: string
          event_id: string
        }[]
      }
      billing_complete_additional_usage_invoice_run: {
        Args: {
          p_amount_cents: number
          p_billing_invoice_run_id: string
          p_claim_token: string
          p_completed_at: string
          p_event_id: string
          p_invoice_id: string
          p_invoice_item_id: string
          p_workspace_id: string
        }
        Returns: {
          billing_invoice_run_id: string
          event_id: string
          invoice_id: string
          invoice_item_id: string
          run_state: string
          workspace_id: string
        }[]
      }
      billing_complete_subscription_cancellation: {
        Args: {
          p_cancellation_request_id: string
          p_completed_at: string
          p_subscription_id: string
          p_workspace_id: string
        }
        Returns: {
          cancellation_request_id: string
          request_state: string
          subscription_id: string
          workspace_id: string
        }[]
      }
      billing_complete_webhook_event: {
        Args: {
          p_claim_token: string
          p_event_id: string
          p_outcome: string
          p_processed_at: string
        }
        Returns: {
          event_id: string
          event_status: string
        }[]
      }
      billing_expire_grace_periods: {
        Args: { p_limit: number; p_now: string }
        Returns: {
          expired_count: number
        }[]
      }
      billing_fail_webhook_event: {
        Args: {
          p_claim_token: string
          p_event_id: string
          p_failed_at: string
          p_failure_code: string
          p_provider_code: string
          p_provider_message: string
        }
        Returns: {
          event_id: string
          event_status: string
        }[]
      }
      billing_get_workspace_account: {
        Args: { p_workspace_id: string }
        Returns: {
          current_period_end: string
          current_period_start: string
          customer_id: string
          default_payment_method_id: string
          monthly_price_cents: number
          subscription_id: string
          subscription_price_id: string
          subscription_status: string
          workspace_id: string
        }[]
      }
      billing_prepare_additional_usage_invoice_run: {
        Args: {
          p_billing_reason: string
          p_claim_token: string
          p_customer_id: string
          p_event_id: string
          p_invoice_created_at: string
          p_invoice_id: string
          p_invoice_period_end: string
          p_invoice_period_start: string
          p_prepared_at: string
          p_subscription_id: string
        }
        Returns: {
          amount_micro_usd: number
          billing_invoice_run_id: string
          customer_id: string
          event_id: string
          invoice_id: string
          ledger_entry_count: number
          run_state: string
          source_period_ids: string[]
          workspace_id: string
        }[]
      }
      billing_prepare_subscription_cancellation: {
        Args: { p_requested_at: string; p_workspace_id: string }
        Returns: {
          cancellation_request_id: string
          request_state: string
          subscription_id: string
          workspace_id: string
        }[]
      }
      billing_record_customer: {
        Args: {
          p_customer_id: string
          p_recorded_at: string
          p_workspace_id: string
        }
        Returns: undefined
      }
      billing_record_setup_intent: {
        Args: {
          p_customer_id: string
          p_recorded_at: string
          p_setup_intent_id: string
          p_workspace_id: string
        }
        Returns: undefined
      }
      billing_record_subscription: {
        Args: {
          p_customer_id: string
          p_latest_invoice_id: string
          p_period_end: string
          p_period_start: string
          p_price_id: string
          p_recorded_at: string
          p_status: string
          p_subscription_id: string
          p_workspace_id: string
        }
        Returns: undefined
      }
      bulk_upsert_contacts: {
        Args: { p_contacts: Json; p_workspace_id: string }
        Returns: {
          action: string
          contact_id: string
          input_index: number
          is_suppressed: boolean
        }[]
      }
      retry_failed_campaign_messages: {
        Args: { p_campaign_id: string; p_now?: string }
        Returns: Json
      }
      claim_campaign_test_send: {
        Args: {
          p_body: string
          p_now?: string
          p_phone_number_id: string
          p_recipient_phone_e164: string
          p_request_id: string
        }
        Returns: {
          disposition: string
          source_phone_e164: string
          workspace_id: string
        }[]
      }
      claim_phone_number_import: {
        Args: {
          p_country_code: string
          p_operation_id: string
          p_phone_e164: string
          p_workspace_id: string
        }
        Returns: {
          disposition: string
          operation_id: string
          phone_number_id: string
        }[]
      }
      claim_phone_number_import_disconnect: {
        Args: {
          p_operation_id: string
          p_phone_number_id: string
          p_workspace_id: string
        }
        Returns: {
          disposition: string
          operation_id: string
          provider_import_id: string
          provider_number_id: string
        }[]
      }
      claim_phone_number_purchase: {
        Args: {
          p_business_verification: Json
          p_operation_id: string
          p_phone_e164: string
          p_selection_nonce: string
          p_workspace_id: string
        }
        Returns: {
          disposition: string
          operation_id: string
          phone_number_id: string
        }[]
      }
      claim_phone_number_release: {
        Args: {
          p_operation_id: string
          p_phone_number_id: string
          p_workspace_id: string
        }
        Returns: {
          disposition: string
          operation_id: string
          provider_number_id: string
        }[]
      }
      complete_phone_number_import_disconnect: {
        Args: {
          p_operation_id: string
          p_phone_number_id: string
          p_workspace_id: string
        }
        Returns: {
          completed: boolean
        }[]
      }
      complete_phone_number_purchase: {
        Args: {
          p_operation_id: string
          p_provider: string
          p_provider_number_id: string
          p_provider_status: string
          p_workspace_id: string
        }
        Returns: {
          completed: boolean
          phone_number_id: string
        }[]
      }
      complete_phone_number_release: {
        Args: {
          p_operation_id: string
          p_phone_number_id: string
          p_workspace_id: string
        }
        Returns: {
          completed: boolean
        }[]
      }
      create_campaign_draft:
        | {
            Args: {
              p_name: string
              p_phone_number_id?: string
              p_steps: Json
              p_workspace_id: string
            }
            Returns: {
              created_at: string
              deleted_at: string | null
              drip_interval_minutes: number
              finished_at: string | null
              id: string
              launched_at: string | null
              name: string
              paused_at: string | null
              phone_number_id: string | null
              send_window_end: string
              send_window_start: string
              sending_days: number[]
              status: string
              timezone: string
              updated_at: string
              workspace_id: string
            }
            SetofOptions: {
              from: "*"
              to: "campaigns"
              isOneToOne: true
              isSetofReturn: false
            }
          }
        | {
            Args: {
              p_drip_interval_minutes?: number
              p_name: string
              p_phone_number_id?: string
              p_send_window_end?: string
              p_send_window_start?: string
              p_steps: Json
              p_timezone?: string
              p_workspace_id: string
            }
            Returns: {
              created_at: string
              deleted_at: string | null
              drip_interval_minutes: number
              finished_at: string | null
              id: string
              launched_at: string | null
              name: string
              paused_at: string | null
              phone_number_id: string | null
              send_window_end: string
              send_window_start: string
              sending_days: number[]
              status: string
              timezone: string
              updated_at: string
              workspace_id: string
            }
            SetofOptions: {
              from: "*"
              to: "campaigns"
              isOneToOne: true
              isSetofReturn: false
            }
          }
        | {
            Args: {
              p_drip_interval_minutes?: number
              p_name: string
              p_phone_number_id?: string
              p_send_window_end?: string
              p_send_window_start?: string
              p_sending_days?: number[]
              p_steps: Json
              p_timezone?: string
              p_workspace_id: string
            }
            Returns: {
              created_at: string
              deleted_at: string | null
              drip_interval_minutes: number
              finished_at: string | null
              id: string
              launched_at: string | null
              name: string
              paused_at: string | null
              phone_number_id: string | null
              send_window_end: string
              send_window_start: string
              sending_days: number[]
              status: string
              timezone: string
              updated_at: string
              workspace_id: string
            }
            SetofOptions: {
              from: "*"
              to: "campaigns"
              isOneToOne: true
              isSetofReturn: false
            }
          }
      create_contact:
        | {
            Args: {
              p_company?: string
              p_country_code: string
              p_first_name?: string
              p_job_title?: string
              p_last_name?: string
              p_notes?: string
              p_phone_e164: string
              p_pipeline_stage_id?: string
              p_workspace_id: string
            }
            Returns: {
              company: string
              country_code: string
              created_at: string
              deleted_at: string | null
              first_name: string
              has_unread_messages: boolean
              id: string
              job_title: string | null
              last_contacted_at: string | null
              last_name: string
              last_replied_at: string | null
              notes: string
              phone_e164: string
              pipeline_stage_id: string
              updated_at: string
              workspace_id: string
            }
            SetofOptions: {
              from: "*"
              to: "contacts"
              isOneToOne: true
              isSetofReturn: false
            }
          }
        | {
            Args: {
              p_company?: string
              p_country_code: string
              p_first_name?: string
              p_job_title?: string
              p_last_name?: string
              p_phone_e164: string
              p_pipeline_stage_id?: string
              p_workspace_id: string
            }
            Returns: {
              company: string
              country_code: string
              created_at: string
              deleted_at: string | null
              first_name: string
              has_unread_messages: boolean
              id: string
              job_title: string | null
              last_contacted_at: string | null
              last_name: string
              last_replied_at: string | null
              notes: string
              phone_e164: string
              pipeline_stage_id: string
              updated_at: string
              workspace_id: string
            }
            SetofOptions: {
              from: "*"
              to: "contacts"
              isOneToOne: true
              isSetofReturn: false
            }
          }
        | {
            Args: {
              p_company?: string
              p_country_code: string
              p_first_name?: string
              p_last_name?: string
              p_phone_e164: string
              p_pipeline_stage_id?: string
              p_workspace_id: string
            }
            Returns: {
              company: string
              country_code: string
              created_at: string
              deleted_at: string | null
              first_name: string
              has_unread_messages: boolean
              id: string
              job_title: string | null
              last_contacted_at: string | null
              last_name: string
              last_replied_at: string | null
              notes: string
              phone_e164: string
              pipeline_stage_id: string
              updated_at: string
              workspace_id: string
            }
            SetofOptions: {
              from: "*"
              to: "contacts"
              isOneToOne: true
              isSetofReturn: false
            }
          }
        | {
            Args: {
              p_company?: string
              p_first_name?: string
              p_last_name?: string
              p_phone_e164: string
              p_pipeline_stage_id?: string
              p_workspace_id: string
            }
            Returns: {
              company: string
              country_code: string
              created_at: string
              deleted_at: string | null
              first_name: string
              has_unread_messages: boolean
              id: string
              job_title: string | null
              last_contacted_at: string | null
              last_name: string
              last_replied_at: string | null
              notes: string
              phone_e164: string
              pipeline_stage_id: string
              updated_at: string
              workspace_id: string
            }
            SetofOptions: {
              from: "*"
              to: "contacts"
              isOneToOne: true
              isSetofReturn: false
            }
          }
      create_pipeline_stage: {
        Args: { p_name: string; p_workspace_id: string }
        Returns: {
          created_at: string
          id: string
          is_default: boolean
          name: string
          position: number
          updated_at: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "pipeline_stages"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      delete_campaign: {
        Args: { p_campaign_id: string }
        Returns: {
          created_at: string
          deleted_at: string | null
          drip_interval_minutes: number
          finished_at: string | null
          id: string
          launched_at: string | null
          name: string
          paused_at: string | null
          phone_number_id: string | null
          send_window_end: string
          send_window_start: string
          sending_days: number[]
          status: string
          timezone: string
          updated_at: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "campaigns"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      delete_pipeline_stage: {
        Args: { p_reassign_to_stage_id?: string; p_stage_id: string }
        Returns: string
      }
      dispatch_claim_and_reserve_next: {
        Args: { p_now?: string; p_worker_id: string }
        Returns: {
          body: string
          campaign_id: string
          campaign_recipient_id: string
          claim_token: string
          contact_id: string
          estimated_segments: number
          message_id: string
          phone_number_id: string
          reservation_id: string
          step_order: number
          workspace_id: string
        }[]
      }
      dispatch_final_validate_and_begin_attempt: {
        Args: { p_claim_token: string; p_message_id: string; p_now?: string }
        Returns: Json
      }
      dispatch_mark_accepted: {
        Args: {
          p_accepted_at?: string
          p_claim_token: string
          p_message_id: string
          p_provider: string
          p_provider_message_id: string
        }
        Returns: {
          accepted_at: string | null
          billing_period_id: string | null
          body: string
          campaign_id: string | null
          campaign_recipient_id: string | null
          contact_id: string
          created_at: string
          delivery_state: string | null
          direction: string
          dispatch_started_at: string | null
          dispatch_state: string
          estimated_segments: number | null
          failed_at: string | null
          failure_code: string | null
          id: string
          in_reply_to_message_id: string | null
          included_segments_snapshot: number | null
          num_segments: number | null
          overage_price_micro_usd_snapshot: number | null
          phone_number_id: string
          received_at: string | null
          reservation_released_at: string | null
          reservation_token: string | null
          reserved_at: string | null
          reserved_billing_period_id: string | null
          reserved_segments: number
          scheduled_for: string | null
          sent_at: string | null
          step_order: number | null
          updated_at: string
          usage_position: number | null
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "messages"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      dispatch_mark_known_failure_and_release: {
        Args: {
          p_claim_token: string
          p_failed_at?: string
          p_message_id: string
          p_provider: string
          p_provider_error_code?: string
          p_provider_error_message?: string
          p_provider_message_id?: string
        }
        Returns: {
          accepted_at: string | null
          billing_period_id: string | null
          body: string
          campaign_id: string | null
          campaign_recipient_id: string | null
          contact_id: string
          created_at: string
          delivery_state: string | null
          direction: string
          dispatch_started_at: string | null
          dispatch_state: string
          estimated_segments: number | null
          failed_at: string | null
          failure_code: string | null
          id: string
          in_reply_to_message_id: string | null
          included_segments_snapshot: number | null
          num_segments: number | null
          overage_price_micro_usd_snapshot: number | null
          phone_number_id: string
          received_at: string | null
          reservation_released_at: string | null
          reservation_token: string | null
          reserved_at: string | null
          reserved_billing_period_id: string | null
          reserved_segments: number
          scheduled_for: string | null
          sent_at: string | null
          step_order: number | null
          updated_at: string
          usage_position: number | null
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "messages"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      dispatch_mark_unknown_and_stop: {
        Args: {
          p_claim_token: string
          p_message_id: string
          p_provider: string
          p_provider_error_code?: string
          p_provider_error_message?: string
          p_provider_message_id?: string
          p_unknown_reason: string
        }
        Returns: {
          accepted_at: string | null
          billing_period_id: string | null
          body: string
          campaign_id: string | null
          campaign_recipient_id: string | null
          contact_id: string
          created_at: string
          delivery_state: string | null
          direction: string
          dispatch_started_at: string | null
          dispatch_state: string
          estimated_segments: number | null
          failed_at: string | null
          failure_code: string | null
          id: string
          in_reply_to_message_id: string | null
          included_segments_snapshot: number | null
          num_segments: number | null
          overage_price_micro_usd_snapshot: number | null
          phone_number_id: string
          received_at: string | null
          reservation_released_at: string | null
          reservation_token: string | null
          reserved_at: string | null
          reserved_billing_period_id: string | null
          reserved_segments: number
          scheduled_for: string | null
          sent_at: string | null
          step_order: number | null
          updated_at: string
          usage_position: number | null
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "messages"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      get_billing_usage_summary: {
        Args: never
        Returns: {
          actual_credits: number
          additional_credit_price_micro_usd: number
          additional_credits: number
          additional_usage_amount_micro_usd: number
          can_cancel_subscription: boolean
          can_open_portal: boolean
          can_setup_payment: boolean
          effective_credits: number
          included_credits: number
          max_phone_numbers: number
          messaging_enabled: boolean
          monthly_price_cents: number
          payment_method_status: string
          reserved_credits: number
          safety_cap_credits: number
          safety_cap_reached: boolean
          subscription_status: string
        }[]
      }
      get_campaign_statistics: {
        Args: { p_campaign_id: string }
        Returns: Json
      }
      get_my_phone_number_import_details: {
        Args: never
        Returns: {
          import_status: string
          phone_number_id: string
          verification_code: string
        }[]
      }
      get_phone_number_import_callback_context: {
        Args: { p_provider_import_id: string }
        Returns: {
          phone_number_id: string
          workspace_id: string
        }[]
      }
      get_phone_number_import_context: {
        Args: { p_phone_number_id: string; p_workspace_id: string }
        Returns: {
          import_status: string
          operation_id: string
          phone_number_id: string
          provider_import_id: string
          provider_number_id: string
          workspace_id: string
        }[]
      }
      inbound_reconciliation_claim_next: {
        Args: { p_now?: string; p_worker_id: string }
        Returns: {
          attempt_count: number
          billing_period_id: string
          message_id: string
          provider: string
          provider_message_id: string
          reconciliation_token: string
          workspace_id: string
        }[]
      }
      inbound_reconciliation_complete: {
        Args: {
          p_actual_segments: number
          p_message_id: string
          p_provider_cost_micro_usd: number
          p_provider_cost_pending: boolean
          p_reconciled_at?: string
          p_reconciliation_token: string
        }
        Returns: {
          accepted_at: string | null
          billing_period_id: string | null
          body: string
          campaign_id: string | null
          campaign_recipient_id: string | null
          contact_id: string
          created_at: string
          delivery_state: string | null
          direction: string
          dispatch_started_at: string | null
          dispatch_state: string
          estimated_segments: number | null
          failed_at: string | null
          failure_code: string | null
          id: string
          in_reply_to_message_id: string | null
          included_segments_snapshot: number | null
          num_segments: number | null
          overage_price_micro_usd_snapshot: number | null
          phone_number_id: string
          received_at: string | null
          reservation_released_at: string | null
          reservation_token: string | null
          reserved_at: string | null
          reserved_billing_period_id: string | null
          reserved_segments: number
          scheduled_for: string | null
          sent_at: string | null
          step_order: number | null
          updated_at: string
          usage_position: number | null
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "messages"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      inbound_reconciliation_defer: {
        Args: {
          p_deferred_at?: string
          p_error_code: string
          p_message_id: string
          p_next_attempt_at: string
          p_reconciliation_token: string
        }
        Returns: undefined
      }
      is_destination_allowed: {
        Args: { p_destination_country: string; p_sender_country: string }
        Returns: boolean
      }
      launch_campaign: {
        Args: {
          p_campaign_id: string
          p_confirmed_assessment?: Json
          p_confirmed_contact_count?: number
          p_confirmed_large_launch?: boolean
          p_consent_confirmed?: boolean
        }
        Returns: Json
      }
      manual_message_claim_and_reserve: {
        Args: {
          p_body: string
          p_contact_id: string
          p_estimated_segments: number
          p_now: string
          p_phone_number_id: string
          p_request_id: string
          p_workspace_id: string
        }
        Returns: {
          claim_token: string
          contact_id: string
          dispatch_state: string
          disposition: string
          estimated_segments: number
          message_id: string
          reservation_id: string
          workspace_id: string
        }[]
      }
      manual_message_final_validate_and_begin_attempt: {
        Args: {
          p_claim_token: string
          p_message_id: string
          p_now: string
          p_workspace_id: string
        }
        Returns: Json
      }
      manual_message_final_validate_before_billing_rollover: {
        Args: {
          p_claim_token: string
          p_message_id: string
          p_now: string
          p_workspace_id: string
        }
        Returns: Json
      }
      manual_message_mark_accepted: {
        Args: {
          p_accepted_at: string
          p_claim_token: string
          p_message_id: string
          p_persisted_at: string
          p_provider: string
          p_provider_message_id: string
        }
        Returns: {
          accepted_at: string | null
          billing_period_id: string | null
          body: string
          campaign_id: string | null
          campaign_recipient_id: string | null
          contact_id: string
          created_at: string
          delivery_state: string | null
          direction: string
          dispatch_started_at: string | null
          dispatch_state: string
          estimated_segments: number | null
          failed_at: string | null
          failure_code: string | null
          id: string
          in_reply_to_message_id: string | null
          included_segments_snapshot: number | null
          num_segments: number | null
          overage_price_micro_usd_snapshot: number | null
          phone_number_id: string
          received_at: string | null
          reservation_released_at: string | null
          reservation_token: string | null
          reserved_at: string | null
          reserved_billing_period_id: string | null
          reserved_segments: number
          scheduled_for: string | null
          sent_at: string | null
          step_order: number | null
          updated_at: string
          usage_position: number | null
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "messages"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      manual_message_mark_known_failure_and_release: {
        Args: {
          p_claim_token: string
          p_failed_at: string
          p_message_id: string
          p_provider: string
          p_provider_error_code: string
          p_provider_error_message: string
          p_provider_message_id: string
        }
        Returns: {
          accepted_at: string | null
          billing_period_id: string | null
          body: string
          campaign_id: string | null
          campaign_recipient_id: string | null
          contact_id: string
          created_at: string
          delivery_state: string | null
          direction: string
          dispatch_started_at: string | null
          dispatch_state: string
          estimated_segments: number | null
          failed_at: string | null
          failure_code: string | null
          id: string
          in_reply_to_message_id: string | null
          included_segments_snapshot: number | null
          num_segments: number | null
          overage_price_micro_usd_snapshot: number | null
          phone_number_id: string
          received_at: string | null
          reservation_released_at: string | null
          reservation_token: string | null
          reserved_at: string | null
          reserved_billing_period_id: string | null
          reserved_segments: number
          scheduled_for: string | null
          sent_at: string | null
          step_order: number | null
          updated_at: string
          usage_position: number | null
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "messages"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      manual_message_mark_unknown: {
        Args: {
          p_claim_token: string
          p_marked_at: string
          p_message_id: string
          p_provider: string
          p_provider_error_code: string
          p_provider_error_message: string
          p_provider_message_id: string
          p_unknown_reason: string
        }
        Returns: {
          accepted_at: string | null
          billing_period_id: string | null
          body: string
          campaign_id: string | null
          campaign_recipient_id: string | null
          contact_id: string
          created_at: string
          delivery_state: string | null
          direction: string
          dispatch_started_at: string | null
          dispatch_state: string
          estimated_segments: number | null
          failed_at: string | null
          failure_code: string | null
          id: string
          in_reply_to_message_id: string | null
          included_segments_snapshot: number | null
          num_segments: number | null
          overage_price_micro_usd_snapshot: number | null
          phone_number_id: string
          received_at: string | null
          reservation_released_at: string | null
          reservation_token: string | null
          reserved_at: string | null
          reserved_billing_period_id: string | null
          reserved_segments: number
          scheduled_for: string | null
          sent_at: string | null
          step_order: number | null
          updated_at: string
          usage_position: number | null
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "messages"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      mark_phone_number_import_disconnect_unknown: {
        Args: {
          p_operation_id: string
          p_phone_number_id: string
          p_provider_code: string
          p_provider_message: string
          p_provider_resource_id: string
          p_workspace_id: string
        }
        Returns: {
          recorded: boolean
        }[]
      }
      mark_phone_number_import_unknown: {
        Args: {
          p_operation_id: string
          p_provider_code: string
          p_provider_message: string
          p_provider_resource_id: string
          p_workspace_id: string
        }
        Returns: {
          recorded: boolean
        }[]
      }
      mark_phone_number_purchase_unknown: {
        Args: {
          p_operation_id: string
          p_provider_code: string
          p_provider_message: string
          p_provider_resource_id: string
          p_workspace_id: string
        }
        Returns: {
          recorded: boolean
        }[]
      }
      mark_phone_number_release_unknown: {
        Args: {
          p_operation_id: string
          p_phone_number_id: string
          p_provider_code: string
          p_provider_message: string
          p_provider_resource_id: string
          p_workspace_id: string
        }
        Returns: {
          recorded: boolean
        }[]
      }
      messaging_claim_number_search: {
        Args: {
          p_request_id: string
          p_requested_at: string
          p_workspace_id: string
        }
        Returns: {
          allowed: boolean
          replayed: boolean
          retry_after_seconds: number
        }[]
      }
      messaging_claim_workspace_setup: {
        Args: { p_operation_id: string; p_workspace_id: string }
        Returns: {
          disposition: string
          operation_id: string
        }[]
      }
      messaging_complete_workspace_setup: {
        Args: {
          p_messaging_service_id: string
          p_operation_id: string
          p_workspace_id: string
        }
        Returns: {
          completed: boolean
        }[]
      }
      messaging_get_workspace_credentials: {
        Args: { p_workspace_id: string }
        Returns: {
          account_id: string
          encrypted_auth_token: string
          messaging_service_id: string
        }[]
      }
      messaging_mark_workspace_setup_unknown: {
        Args: {
          p_operation_id: string
          p_provider_code: string
          p_provider_message: string
          p_provider_resource_id: string
          p_step: string
          p_workspace_id: string
        }
        Returns: {
          recorded: boolean
        }[]
      }
      messaging_record_workspace_account: {
        Args: {
          p_encrypted_auth_token: string
          p_operation_id: string
          p_provider: string
          p_provider_account_id: string
          p_workspace_id: string
        }
        Returns: {
          recorded: boolean
        }[]
      }
      move_contact_to_stage: {
        Args: { p_contact_id: string; p_pipeline_stage_id: string }
        Returns: {
          company: string
          country_code: string
          created_at: string
          deleted_at: string | null
          first_name: string
          has_unread_messages: boolean
          id: string
          job_title: string | null
          last_contacted_at: string | null
          last_name: string
          last_replied_at: string | null
          notes: string
          phone_e164: string
          pipeline_stage_id: string
          updated_at: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "contacts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      pause_campaign: {
        Args: { p_campaign_id: string }
        Returns: {
          created_at: string
          deleted_at: string | null
          drip_interval_minutes: number
          finished_at: string | null
          id: string
          launched_at: string | null
          name: string
          paused_at: string | null
          phone_number_id: string | null
          send_window_end: string
          send_window_start: string
          sending_days: number[]
          status: string
          timezone: string
          updated_at: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "campaigns"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      reconciliation_claim_next: {
        Args: { p_now?: string; p_worker_id: string }
        Returns: {
          billing_period_id: string
          campaign_id: string
          campaign_recipient_id: string
          contact_id: string
          message_id: string
          provider: string
          provider_message_id: string
          reconciliation_token: string
          reservation_id: string
          usage_position: number
          workspace_id: string
        }[]
      }
      reconciliation_complete: {
        Args: {
          p_actual_segments: number
          p_message_id: string
          p_provider_cost_micro_usd: number
          p_provider_cost_pending: boolean
          p_reconciled_at?: string
          p_reconciliation_token: string
        }
        Returns: {
          accepted_at: string | null
          billing_period_id: string | null
          body: string
          campaign_id: string | null
          campaign_recipient_id: string | null
          contact_id: string
          created_at: string
          delivery_state: string | null
          direction: string
          dispatch_started_at: string | null
          dispatch_state: string
          estimated_segments: number | null
          failed_at: string | null
          failure_code: string | null
          id: string
          in_reply_to_message_id: string | null
          included_segments_snapshot: number | null
          num_segments: number | null
          overage_price_micro_usd_snapshot: number | null
          phone_number_id: string
          received_at: string | null
          reservation_released_at: string | null
          reservation_token: string | null
          reserved_at: string | null
          reserved_billing_period_id: string | null
          reserved_segments: number
          scheduled_for: string | null
          sent_at: string | null
          step_order: number | null
          updated_at: string
          usage_position: number | null
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "messages"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      reconciliation_defer: {
        Args: {
          p_deferred_at?: string
          p_message_id: string
          p_next_attempt_at?: string
          p_reason: string
          p_reconciliation_token: string
        }
        Returns: undefined
      }
      reconciliation_record_delivery_state: {
        Args: {
          p_delivery_state: string
          p_message_id: string
          p_observed_at: string
          p_reconciliation_token: string
        }
        Returns: {
          accepted_at: string | null
          billing_period_id: string | null
          body: string
          campaign_id: string | null
          campaign_recipient_id: string | null
          contact_id: string
          created_at: string
          delivery_state: string | null
          direction: string
          dispatch_started_at: string | null
          dispatch_state: string
          estimated_segments: number | null
          failed_at: string | null
          failure_code: string | null
          id: string
          in_reply_to_message_id: string | null
          included_segments_snapshot: number | null
          num_segments: number | null
          overage_price_micro_usd_snapshot: number | null
          phone_number_id: string
          received_at: string | null
          reservation_released_at: string | null
          reservation_token: string | null
          reserved_at: string | null
          reserved_billing_period_id: string | null
          reserved_segments: number
          scheduled_for: string | null
          sent_at: string | null
          step_order: number | null
          updated_at: string
          usage_position: number | null
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "messages"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      reconciliation_record_provider_cost: {
        Args: {
          p_message_id: string
          p_observed_at: string
          p_provider_cost_micro_usd: number
          p_provider_cost_pending: boolean
          p_reconciliation_token: string
        }
        Returns: {
          accepted_at: string | null
          billing_period_id: string | null
          body: string
          campaign_id: string | null
          campaign_recipient_id: string | null
          contact_id: string
          created_at: string
          delivery_state: string | null
          direction: string
          dispatch_started_at: string | null
          dispatch_state: string
          estimated_segments: number | null
          failed_at: string | null
          failure_code: string | null
          id: string
          in_reply_to_message_id: string | null
          included_segments_snapshot: number | null
          num_segments: number | null
          overage_price_micro_usd_snapshot: number | null
          phone_number_id: string
          received_at: string | null
          reservation_released_at: string | null
          reservation_token: string | null
          reserved_at: string | null
          reserved_billing_period_id: string | null
          reserved_segments: number
          scheduled_for: string | null
          sent_at: string | null
          step_order: number | null
          updated_at: string
          usage_position: number | null
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "messages"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      record_phone_number_import_started: {
        Args: {
          p_import_status: string
          p_operation_id: string
          p_provider: string
          p_provider_import_id: string
          p_provider_status: string
          p_verification_code: string
          p_workspace_id: string
        }
        Returns: {
          phone_number_id: string
          recorded: boolean
        }[]
      }
      rename_pipeline_stage: {
        Args: { p_name: string; p_stage_id: string }
        Returns: {
          created_at: string
          id: string
          is_default: boolean
          name: string
          position: number
          updated_at: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "pipeline_stages"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      reorder_pipeline_stages: {
        Args: { p_stage_ids: string[]; p_workspace_id: string }
        Returns: {
          created_at: string
          id: string
          is_default: boolean
          name: string
          position: number
          updated_at: string
          workspace_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "pipeline_stages"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      resolve_sms_webhook_context: {
        Args: { p_kind: string; p_value: string }
        Returns: Json
      }
      restore_contact: {
        Args: { p_contact_id: string; p_pipeline_stage_id?: string }
        Returns: {
          company: string
          country_code: string
          created_at: string
          deleted_at: string | null
          first_name: string
          has_unread_messages: boolean
          id: string
          job_title: string | null
          last_contacted_at: string | null
          last_name: string
          last_replied_at: string | null
          notes: string
          phone_e164: string
          pipeline_stage_id: string
          updated_at: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "contacts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      resume_campaign: {
        Args: { p_campaign_id: string }
        Returns: {
          created_at: string
          deleted_at: string | null
          drip_interval_minutes: number
          finished_at: string | null
          id: string
          launched_at: string | null
          name: string
          paused_at: string | null
          phone_number_id: string | null
          send_window_end: string
          send_window_start: string
          sending_days: number[]
          status: string
          timezone: string
          updated_at: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "campaigns"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      save_campaign_draft:
        | {
            Args: {
              p_campaign_id: string
              p_contact_ids: string[]
              p_name: string
              p_phone_number_id: string
              p_steps: Json
              p_workspace_id: string
            }
            Returns: {
              created_at: string
              deleted_at: string | null
              drip_interval_minutes: number
              finished_at: string | null
              id: string
              launched_at: string | null
              name: string
              paused_at: string | null
              phone_number_id: string | null
              send_window_end: string
              send_window_start: string
              sending_days: number[]
              status: string
              timezone: string
              updated_at: string
              workspace_id: string
            }
            SetofOptions: {
              from: "*"
              to: "campaigns"
              isOneToOne: true
              isSetofReturn: false
            }
          }
        | {
            Args: {
              p_campaign_id: string
              p_contact_ids: string[]
              p_drip_interval_minutes?: number
              p_name: string
              p_phone_number_id: string
              p_send_window_end?: string
              p_send_window_start?: string
              p_steps: Json
              p_timezone?: string
              p_workspace_id: string
            }
            Returns: {
              created_at: string
              deleted_at: string | null
              drip_interval_minutes: number
              finished_at: string | null
              id: string
              launched_at: string | null
              name: string
              paused_at: string | null
              phone_number_id: string | null
              send_window_end: string
              send_window_start: string
              sending_days: number[]
              status: string
              timezone: string
              updated_at: string
              workspace_id: string
            }
            SetofOptions: {
              from: "*"
              to: "campaigns"
              isOneToOne: true
              isSetofReturn: false
            }
          }
        | {
            Args: {
              p_campaign_id: string
              p_contact_ids: string[]
              p_drip_interval_minutes?: number
              p_name: string
              p_phone_number_id: string
              p_send_window_end?: string
              p_send_window_start?: string
              p_sending_days?: number[]
              p_steps: Json
              p_timezone?: string
              p_workspace_id: string
            }
            Returns: {
              created_at: string
              deleted_at: string | null
              drip_interval_minutes: number
              finished_at: string | null
              id: string
              launched_at: string | null
              name: string
              paused_at: string | null
              phone_number_id: string | null
              send_window_end: string
              send_window_start: string
              sending_days: number[]
              status: string
              timezone: string
              updated_at: string
              workspace_id: string
            }
            SetofOptions: {
              from: "*"
              to: "campaigns"
              isOneToOne: true
              isSetofReturn: false
            }
          }
      send_manual_message_simulated: {
        Args: {
          p_body: string
          p_contact_id: string
          p_phone_number_id: string
        }
        Returns: {
          accepted_at: string | null
          billing_period_id: string | null
          body: string
          campaign_id: string | null
          campaign_recipient_id: string | null
          contact_id: string
          created_at: string
          delivery_state: string | null
          direction: string
          dispatch_started_at: string | null
          dispatch_state: string
          estimated_segments: number | null
          failed_at: string | null
          failure_code: string | null
          id: string
          in_reply_to_message_id: string | null
          included_segments_snapshot: number | null
          num_segments: number | null
          overage_price_micro_usd_snapshot: number | null
          phone_number_id: string
          received_at: string | null
          reservation_released_at: string | null
          reservation_token: string | null
          reserved_at: string | null
          reserved_billing_period_id: string | null
          reserved_segments: number
          scheduled_for: string | null
          sent_at: string | null
          step_order: number | null
          updated_at: string
          usage_position: number | null
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "messages"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_default_pipeline_stage: {
        Args: { p_stage_id: string }
        Returns: {
          created_at: string
          id: string
          is_default: boolean
          name: string
          position: number
          updated_at: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "pipeline_stages"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      soft_delete_contact: {
        Args: { p_contact_id: string }
        Returns: {
          company: string
          country_code: string
          created_at: string
          deleted_at: string | null
          first_name: string
          has_unread_messages: boolean
          id: string
          job_title: string | null
          last_contacted_at: string | null
          last_name: string
          last_replied_at: string | null
          notes: string
          phone_e164: string
          pipeline_stage_id: string
          updated_at: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "contacts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_campaign_draft:
        | {
            Args: {
              p_campaign_id: string
              p_name: string
              p_phone_number_id?: string
              p_steps: Json
            }
            Returns: {
              created_at: string
              deleted_at: string | null
              drip_interval_minutes: number
              finished_at: string | null
              id: string
              launched_at: string | null
              name: string
              paused_at: string | null
              phone_number_id: string | null
              send_window_end: string
              send_window_start: string
              sending_days: number[]
              status: string
              timezone: string
              updated_at: string
              workspace_id: string
            }
            SetofOptions: {
              from: "*"
              to: "campaigns"
              isOneToOne: true
              isSetofReturn: false
            }
          }
        | {
            Args: {
              p_campaign_id: string
              p_drip_interval_minutes?: number
              p_name: string
              p_phone_number_id?: string
              p_send_window_end?: string
              p_send_window_start?: string
              p_steps: Json
              p_timezone?: string
            }
            Returns: {
              created_at: string
              deleted_at: string | null
              drip_interval_minutes: number
              finished_at: string | null
              id: string
              launched_at: string | null
              name: string
              paused_at: string | null
              phone_number_id: string | null
              send_window_end: string
              send_window_start: string
              sending_days: number[]
              status: string
              timezone: string
              updated_at: string
              workspace_id: string
            }
            SetofOptions: {
              from: "*"
              to: "campaigns"
              isOneToOne: true
              isSetofReturn: false
            }
          }
        | {
            Args: {
              p_campaign_id: string
              p_drip_interval_minutes?: number
              p_name: string
              p_phone_number_id?: string
              p_send_window_end?: string
              p_send_window_start?: string
              p_sending_days?: number[]
              p_steps: Json
              p_timezone?: string
            }
            Returns: {
              created_at: string
              deleted_at: string | null
              drip_interval_minutes: number
              finished_at: string | null
              id: string
              launched_at: string | null
              name: string
              paused_at: string | null
              phone_number_id: string | null
              send_window_end: string
              send_window_start: string
              sending_days: number[]
              status: string
              timezone: string
              updated_at: string
              workspace_id: string
            }
            SetofOptions: {
              from: "*"
              to: "campaigns"
              isOneToOne: true
              isSetofReturn: false
            }
          }
      update_contact:
        | {
            Args: {
              p_company: string
              p_contact_id: string
              p_country_code: string
              p_first_name: string
              p_job_title: string
              p_last_name: string
              p_notes: string
              p_phone_e164: string
              p_pipeline_stage_id?: string
            }
            Returns: {
              company: string
              country_code: string
              created_at: string
              deleted_at: string | null
              first_name: string
              has_unread_messages: boolean
              id: string
              job_title: string | null
              last_contacted_at: string | null
              last_name: string
              last_replied_at: string | null
              notes: string
              phone_e164: string
              pipeline_stage_id: string
              updated_at: string
              workspace_id: string
            }
            SetofOptions: {
              from: "*"
              to: "contacts"
              isOneToOne: true
              isSetofReturn: false
            }
          }
        | {
            Args: {
              p_company: string
              p_contact_id: string
              p_country_code: string
              p_first_name: string
              p_job_title: string
              p_last_name: string
              p_phone_e164: string
              p_pipeline_stage_id?: string
            }
            Returns: {
              company: string
              country_code: string
              created_at: string
              deleted_at: string | null
              first_name: string
              has_unread_messages: boolean
              id: string
              job_title: string | null
              last_contacted_at: string | null
              last_name: string
              last_replied_at: string | null
              notes: string
              phone_e164: string
              pipeline_stage_id: string
              updated_at: string
              workspace_id: string
            }
            SetofOptions: {
              from: "*"
              to: "contacts"
              isOneToOne: true
              isSetofReturn: false
            }
          }
        | {
            Args: {
              p_company: string
              p_contact_id: string
              p_country_code: string
              p_first_name: string
              p_last_name: string
              p_phone_e164: string
              p_pipeline_stage_id?: string
            }
            Returns: {
              company: string
              country_code: string
              created_at: string
              deleted_at: string | null
              first_name: string
              has_unread_messages: boolean
              id: string
              job_title: string | null
              last_contacted_at: string | null
              last_name: string
              last_replied_at: string | null
              notes: string
              phone_e164: string
              pipeline_stage_id: string
              updated_at: string
              workspace_id: string
            }
            SetofOptions: {
              from: "*"
              to: "contacts"
              isOneToOne: true
              isSetofReturn: false
            }
          }
        | {
            Args: {
              p_company: string
              p_contact_id: string
              p_first_name: string
              p_last_name: string
              p_phone_e164: string
              p_pipeline_stage_id?: string
            }
            Returns: {
              company: string
              country_code: string
              created_at: string
              deleted_at: string | null
              first_name: string
              has_unread_messages: boolean
              id: string
              job_title: string | null
              last_contacted_at: string | null
              last_name: string
              last_replied_at: string | null
              notes: string
              phone_e164: string
              pipeline_stage_id: string
              updated_at: string
              workspace_id: string
            }
            SetofOptions: {
              from: "*"
              to: "contacts"
              isOneToOne: true
              isSetofReturn: false
            }
          }
      update_phone_number_import_status: {
        Args: {
          p_import_status: string
          p_observed_at: string
          p_phone_number_id: string
          p_provider_number_id: string
          p_provider_status: string
          p_usable: boolean
          p_verification_code: string
          p_workspace_id: string
        }
        Returns: {
          updated: boolean
        }[]
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const

