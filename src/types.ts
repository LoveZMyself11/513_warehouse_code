export type InventoryStatus = "confirmed" | "pending" | "overview";

export interface InventoryItem {
  id: string;
  name: string;
  locationCode: string;
  specification: string;
  quantity: string;
  imageName: string;
  imagePath: string;
  recognitionStatus: string;
  status: InventoryStatus;
  sourceSequence: number;
  createdAt: string;
  updatedAt: string;
}

export interface LocationHistory {
  id: string;
  itemId: string;
  fromLocation: string | null;
  toLocation: string;
  movedAt: string;
}

export type UserRole = "super_admin" | "admin" | "member";

export interface UserProfile {
  id: number;
  studentId: string | null;
  name: string;
  departmentId: number | null;
  phone: string | null;
  email: string | null;
  position: string | null;
  notes: string | null;
  role: UserRole;
  isActive: boolean;
}

export interface ManagedUser extends UserProfile {
  authUserId: string | null;
  createdAt: string;
}

export interface Department {
  id: number;
  name: string;
  description: string;
  createdAt: string;
}

export type ActivityStatus = "draft" | "active" | "archived";

export interface Activity {
  id: number;
  name: string;
  description: string;
  departmentId: number | null;
  status: ActivityStatus;
  startDate: string | null;
  endDate: string | null;
  createdBy: number | null;
  createdAt: string;
  updatedAt: string;
}

export type BorrowOrderStatus = "pending" | "approved" | "borrowed" | "return_requested" | "returned" | "cancelled";

export interface BorrowOrder {
  id: number;
  orderNumber: string;
  userId: number;
  departmentId: number | null;
  status: BorrowOrderStatus;
  activityId: number | null;
  borrowedAt: string | null;
  returnSubmittedAt: string | null;
  reason: string | null;
  expectedReturnDate: string | null;
  actualReturnDate: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export type ChangeRequestType = "create" | "update" | "delete";
export type ChangeRequestStatus = "pending" | "approved" | "rejected";

export interface InventoryChangeRequest {
  id: number;
  requestType: ChangeRequestType;
  itemId: string | null;
  resultItemId: string | null;
  proposedName: string | null;
  proposedLocationCode: string | null;
  proposedSpecification: string | null;
  proposedQuantity: string | null;
  proposedImageName: string | null;
  proposedImagePath: string | null;
  reason: string | null;
  status: ChangeRequestStatus;
  requestedBy: number;
  reviewedBy: number | null;
  reviewNote: string | null;
  createdAt: string;
}
