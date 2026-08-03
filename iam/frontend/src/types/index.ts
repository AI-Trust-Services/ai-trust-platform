export interface RoleInfo {
  name: string;
  permissions: string[];
}

export interface UserRole {
  username: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  enabled: boolean;
  role: string | null;
}

export interface PermissionsResponse {
  username: string;
  permissions: string[];
}
