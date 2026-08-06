export interface UserSummary {
  id: string;
  username: string;
  email: string;
  firstName: string;
  lastName: string;
  enabled: boolean;
  emailVerified: boolean;
  roles: string[];
  createdTimestamp: number | null;
}

export interface UserDetail extends UserSummary {
  attributes: Record<string, string[]>;
}

export interface UsersListResponse {
  total: number;
  users: UserSummary[];
}

export interface RoleSummary {
  id: string;
  name: string;
  description: string;
}

export interface RoleInfo {
  name: string;
  permissions: string[];
}

export interface InviteUserRequest {
  username: string;
  email: string;
  firstName: string;
  lastName: string;
  department: string;
  businessUnit: string;
  jobTitle: string;
  phone: string;
  preferredLanguage: string;
  temporaryPassword: string;
}

export interface UpdateUserRequest {
  firstName?: string;
  lastName?: string;
  email?: string;
  department?: string;
  businessUnit?: string;
  jobTitle?: string;
  phone?: string;
  preferredLanguage?: string;
}

export interface CustomRole {
  id: string;
  name: string;
  description: string;
  permissions: string[];
  created_at: string;
}

export interface CustomRoleCreate {
  name: string;
  description: string;
  permissions: string[];
}

export interface CustomRoleUpdate {
  description?: string;
  permissions?: string[];
}
