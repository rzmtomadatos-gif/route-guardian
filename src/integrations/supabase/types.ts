export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      allowed_emails: {
        Row: {
          added_at: string
          email: string
          id: string
          notes: string | null
        }
        Insert: {
          added_at?: string
          email: string
          id?: string
          notes?: string | null
        }
        Update: {
          added_at?: string
          email?: string
          id?: string
          notes?: string | null
        }
        Relationships: []
      }
      copilot_pairings: {
        Row: {
          consume_attempts: number
          consumed_at: string | null
          consumed_by_user_id: string | null
          created_at: string
          expires_at: string
          id: string
          last_attempt_at: string | null
          nonce_hash: string
          operator_user_id: string
          revoked_at: string | null
          revoked_reason: string | null
          session_id: string
        }
        Insert: {
          consume_attempts?: number
          consumed_at?: string | null
          consumed_by_user_id?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          last_attempt_at?: string | null
          nonce_hash: string
          operator_user_id: string
          revoked_at?: string | null
          revoked_reason?: string | null
          session_id: string
        }
        Update: {
          consume_attempts?: number
          consumed_at?: string | null
          consumed_by_user_id?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          last_attempt_at?: string | null
          nonce_hash?: string
          operator_user_id?: string
          revoked_at?: string | null
          revoked_reason?: string | null
          session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "copilot_pairings_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "copilot_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      copilot_session_events: {
        Row: {
          actor: string
          actor_user_id: string | null
          created_at: string
          event_type: string
          id: string
          payload: Json
          session_id: string
        }
        Insert: {
          actor: string
          actor_user_id?: string | null
          created_at?: string
          event_type: string
          id?: string
          payload?: Json
          session_id: string
        }
        Update: {
          actor?: string
          actor_user_id?: string | null
          created_at?: string
          event_type?: string
          id?: string
          payload?: Json
          session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "copilot_session_events_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "copilot_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      copilot_sessions: {
        Row: {
          batch_number: number
          batch_url: string | null
          created_at: string
          cursor_index: number
          destination_lat: number | null
          destination_lng: number | null
          driver_last_seen_at: string | null
          driver_token_hash: string | null
          driver_token_issued_at: string | null
          driver_user_id: string | null
          expires_at: string | null
          id: string
          last_route_opened_at: string | null
          last_route_opened_batch: number | null
          last_route_received_batch: number | null
          operator_user_id: string | null
          queue: Json
          segment_id: string | null
          segment_name: string | null
          status: string
          token: string | null
          track_number: number | null
          updated_at: string
        }
        Insert: {
          batch_number?: number
          batch_url?: string | null
          created_at?: string
          cursor_index?: number
          destination_lat?: number | null
          destination_lng?: number | null
          driver_last_seen_at?: string | null
          driver_token_hash?: string | null
          driver_token_issued_at?: string | null
          driver_user_id?: string | null
          expires_at?: string | null
          id?: string
          last_route_opened_at?: string | null
          last_route_opened_batch?: number | null
          last_route_received_batch?: number | null
          operator_user_id?: string | null
          queue?: Json
          segment_id?: string | null
          segment_name?: string | null
          status?: string
          token?: string | null
          track_number?: number | null
          updated_at?: string
        }
        Update: {
          batch_number?: number
          batch_url?: string | null
          created_at?: string
          cursor_index?: number
          destination_lat?: number | null
          destination_lng?: number | null
          driver_last_seen_at?: string | null
          driver_token_hash?: string | null
          driver_token_issued_at?: string | null
          driver_user_id?: string | null
          expires_at?: string | null
          id?: string
          last_route_opened_at?: string | null
          last_route_opened_batch?: number | null
          last_route_received_batch?: number | null
          operator_user_id?: string | null
          queue?: Json
          segment_id?: string | null
          segment_name?: string | null
          status?: string
          token?: string | null
          track_number?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      organizations: {
        Row: {
          created_at: string
          id: string
          name: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          organization_id: string | null
        }
        Insert: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          organization_id?: string | null
        }
        Update: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          organization_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      _gen_url_token: { Args: { p_bytes?: number }; Returns: string }
      check_email_allowed: { Args: { p_email: string }; Returns: boolean }
      claim_driver_pairing: { Args: { p_nonce: string }; Returns: Json }
      create_copilot_session: { Args: never; Returns: Json }
      delete_copilot_session: { Args: { p_token: string }; Returns: undefined }
      driver_mark_route_opened: {
        Args: { p_batch_number: number; p_driver_token: string }
        Returns: Json
      }
      driver_read_session: { Args: { p_driver_token: string }; Returns: Json }
      driver_report_recovered: {
        Args: { p_driver_token: string }
        Returns: undefined
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      hash_token: { Args: { p_token: string }; Returns: string }
      operator_end_session: {
        Args: { p_session_id: string }
        Returns: undefined
      }
      operator_generate_pairing: {
        Args: { p_session_id: string }
        Returns: Json
      }
      operator_get_session: { Args: { p_session_id: string }; Returns: Json }
      operator_send_batch: {
        Args: {
          p_batch_url: string
          p_cursor_index: number
          p_queue: Json
          p_segment_meta?: Json
          p_session_id: string
        }
        Returns: Json
      }
      operator_update_session: {
        Args: { p_session_id: string; p_updates: Json }
        Returns: Json
      }
      read_copilot_session_by_token: {
        Args: { p_token: string }
        Returns: Json
      }
      update_copilot_session: {
        Args: { p_token: string; p_updates: Json }
        Returns: Json
      }
      update_own_profile: {
        Args: { p_email?: string; p_full_name?: string }
        Returns: undefined
      }
    }
    Enums: {
      app_role: "admin" | "supervisor" | "operator" | "gabinete" | "driver"
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
  public: {
    Enums: {
      app_role: ["admin", "supervisor", "operator", "gabinete", "driver"],
    },
  },
} as const
