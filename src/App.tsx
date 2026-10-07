import { type ChangeEvent, type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Archive,
  Ban,
  Box,
  Boxes,
  Camera,
  Check,
  CalendarRange,
  ChevronRight,
  CircleAlert,
  CalendarClock,
  ClipboardList,
  Clock3,
  Building2,
  BellRing,
  DoorOpen,
  Edit3,
  FileSpreadsheet,
  Layers3,
  ListChecks,
  LogOut,
  MapPin,
  Menu,
  MoreHorizontal,
  PackagePlus,
  PackageCheck,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  Trash2,
  UsersRound,
  X,
} from "lucide-react";
import { useLocation } from "react-router-dom";
import { useAuth } from "./auth/AuthProvider";
import { assetUrl } from "./lib/assetUrl";
import { locationLabel, locations } from "./locations";
import type {
  Activity,
  ActivityStatus,
  BorrowOrder,
  BorrowOrderStatus,
  Department,
  InventoryChangeRequest,
  InventoryItem,
  InventoryStatus,
  LocationHistory,
  ManagedUser,
  UserRole,
} from "./types";

type Selection = "ALL" | "PENDING" | string;
type EditorMode = "create" | "edit";
type AppView = "inventory" | "requests" | "departments" | "users" | "borrows" | "activities" | "announcements";

interface DbInventoryRow {
  id: string;
  name: string;
  location_code: string;
  specification: string | null;
  quantity: string;
  image_name: string | null;
  image_path: string | null;
  recognition_status: string;
  source_sequence: number | null;
  created_at: string;
  updated_at: string;
}

interface DbHistoryRow {
  id: number;
  item_id: string;
  from_location: string | null;
  to_location: string;
  moved_at: string;
}

interface DbRequestRow {
  id: number;
  request_type: InventoryChangeRequest["requestType"];
  item_id: string | null;
  result_item_id: string | null;
  proposed_name: string | null;
  proposed_location_code: string | null;
  proposed_specification: string | null;
  proposed_quantity: string | null;
  proposed_image_name: string | null;
  proposed_image_path: string | null;
  reason: string | null;
  status: InventoryChangeRequest["status"];
  requested_by: number;
  reviewed_by: number | null;
  review_note: string | null;
  created_at: string;
}

interface DbDepartmentRow {
  id: number;
  name: string;
  description: string | null;
  created_at: string;
}

interface DbActivityRow {
  id: number;
  name: string;
  description: string | null;
  department_id: number | null;
  status: ActivityStatus;
  start_date: string | null;
  end_date: string | null;
  created_by: number | null;
  created_at: string;
  updated_at: string;
}

interface DbAnnouncementRow {
  id: number;
  title: string;
  content: string;
  target_role: UserRole | null;
  is_active: boolean;
  starts_at: string;
  ends_at: string | null;
  created_by: number | null;
  created_at: string;
  updated_at: string;
}

interface DbUserRow {
  id: number;
  student_id: string | null;
  name: string;
  department_id: number | null;
  phone: string | null;
  email: string | null;
  position: string | null;
  notes: string | null;
  role: UserRole;
  is_active: boolean;
  auth_user_id: string | null;
  created_at: string;
}

interface DbBorrowOrderRow {
  id: number;
  order_number: string;
  user_id: number;
  department_id: number | null;
  activity_id: number | null;
  status: BorrowOrderStatus;
  borrowed_at: string | null;
  return_submitted_at: string | null;
  reason: string | null;
  expected_return_date: string | null;
  actual_return_date: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

interface DbBorrowItemRow {
  id: number;
  order_id: number;
  item_id: string;
  borrow_location_code: string | null;
  quantity_borrowed: number;
  quantity_returned: number;
  item_condition: string;
  notes: string | null;
}

interface DbBorrowReturnRequestRow {
  id: number;
  order_id: number;
  user_id: number;
  status: "pending" | "approved" | "rejected";
  submitted_at: string;
  reviewed_by: number | null;
  reviewed_at: string | null;
  review_note: string | null;
  notes: string | null;
}

interface DbBorrowReturnItemRow {
  id: number;
  return_request_id: number;
  borrow_item_id: number;
  item_id: string;
  original_location_code: string;
  returned_location_code: string;
  photo_path: string | null;
  item_condition: "good" | "damaged" | "lost";
  notes: string | null;
  created_at: string;
}

interface DbBorrowSummaryRow {
  item_id: string;
  order_id: number;
  order_number: string;
  borrower_name: string;
  department_name: string | null;
  borrowed_at: string;
  expected_return_date: string | null;
  activity_id: number | null;
  activity_name: string | null;
}

const isPendingLocation = (code: string) => code.startsWith("PENDING_");
const isShelf = (selection: string) => /^[A-D]$/.test(selection);
const IMAGE_BUCKET = "inventory-images";
const RETURN_IMAGE_BUCKET = "borrow-return-images";
const MAX_IMAGE_SIZE = 10 * 1024 * 1024;
const IMAGE_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
};

const validateImageFile = (file: File) => {
  if (!Object.hasOwn(IMAGE_EXTENSIONS, file.type)) {
    return "仅支持 JPEG、PNG、WebP、HEIC 或 HEIF 图片。";
  }
  if (file.size > MAX_IMAGE_SIZE) return "图片不能超过 10 MB。";
  return null;
};

const storageFileName = (itemName: string, file: File) => {
  const safeName = itemName
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}]+/gu, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48) || "item";
  const suffix = crypto.randomUUID().slice(0, 8);
  return `${safeName}_${Date.now()}_${suffix}.${IMAGE_EXTENSIONS[file.type]}`;
};

const formatDateTime = (value: string | null | undefined) => {
  if (!value) return "未记录";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
};

const errorMessage = (error: unknown) => error instanceof Error
  ? error.message
  : typeof error === "object" && error !== null && "message" in error
    ? String(error.message)
    : "操作失败，请稍后重试。";

const matchesSelection = (item: InventoryItem, selection: Selection) => {
  if (selection === "ALL") return true;
  if (selection === "PENDING") return isPendingLocation(item.locationCode);
  if (isShelf(selection)) return item.locationCode.startsWith(selection) || item.locationCode === `PENDING_${selection}`;
  return item.locationCode === selection;
};

const inventoryStatus = (recognitionStatus: string): InventoryStatus => {
  if (recognitionStatus === "区域总览") return "overview";
  if (recognitionStatus.includes("待确认")) return "pending";
  return "confirmed";
};

const mapItem = (row: DbInventoryRow): InventoryItem => ({
  id: row.id,
  name: row.name,
  locationCode: row.location_code,
  specification: row.specification ?? "",
  quantity: row.quantity,
  imageName: row.image_name ?? "",
  imagePath: row.image_path ?? "",
  recognitionStatus: row.recognition_status,
  status: inventoryStatus(row.recognition_status),
  sourceSequence: row.source_sequence ?? 0,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const mapHistory = (row: DbHistoryRow): LocationHistory => ({
  id: String(row.id),
  itemId: row.item_id,
  fromLocation: row.from_location,
  toLocation: row.to_location,
  movedAt: row.moved_at,
});

const mapRequest = (row: DbRequestRow): InventoryChangeRequest => ({
  id: row.id,
  requestType: row.request_type,
  itemId: row.item_id,
  resultItemId: row.result_item_id,
  proposedName: row.proposed_name,
  proposedLocationCode: row.proposed_location_code,
  proposedSpecification: row.proposed_specification,
  proposedQuantity: row.proposed_quantity,
  proposedImageName: row.proposed_image_name,
  proposedImagePath: row.proposed_image_path,
  reason: row.reason,
  status: row.status,
  requestedBy: row.requested_by,
  reviewedBy: row.reviewed_by,
  reviewNote: row.review_note,
  createdAt: row.created_at,
});

const mapDepartment = (row: DbDepartmentRow): Department => ({
  id: row.id,
  name: row.name,
  description: row.description ?? "",
  createdAt: row.created_at,
});

const mapActivity = (row: DbActivityRow): Activity => ({
  id: row.id,
  name: row.name,
  description: row.description ?? "",
  departmentId: row.department_id,
  status: row.status,
  startDate: row.start_date,
  endDate: row.end_date,
  createdBy: row.created_by,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const mapUser = (row: DbUserRow): ManagedUser => ({
  id: row.id,
  studentId: row.student_id,
  name: row.name,
  departmentId: row.department_id,
  phone: row.phone,
  email: row.email,
  position: row.position,
  notes: row.notes,
  role: row.role,
  isActive: row.is_active,
  authUserId: row.auth_user_id,
  createdAt: row.created_at,
});

const mapBorrowOrder = (row: DbBorrowOrderRow): BorrowOrder => ({
  id: row.id,
  orderNumber: row.order_number,
  userId: row.user_id,
  departmentId: row.department_id,
  activityId: row.activity_id,
  status: row.status,
  borrowedAt: row.borrowed_at,
  returnSubmittedAt: row.return_submitted_at,
  reason: row.reason,
  expectedReturnDate: row.expected_return_date,
  actualReturnDate: row.actual_return_date,
  notes: row.notes,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const statusMeta = (item: InventoryItem) => {
  if (item.status === "overview") return { text: "区域总览", className: "overview" };
  if (item.status === "pending") return { text: "待核对", className: "pending" };
  return { text: "已确认", className: "confirmed" };
};

const requestMeta = {
  create: { label: "新增", className: "confirmed" },
  update: { label: "修改", className: "overview" },
  delete: { label: "删除", className: "pending" },
};

const requestStatusMeta = {
  pending: { label: "待审批", className: "pending" },
  approved: { label: "已批准", className: "confirmed" },
  rejected: { label: "已拒绝", className: "overview" },
};

const roleMeta: Record<UserRole, string> = {
  super_admin: "超级管理员",
  admin: "普通管理员",
  member: "普通用户",
};

const borrowStatusMeta: Record<BorrowOrderStatus, { label: string; className: string }> = {
  pending: { label: "待审批", className: "pending" },
  approved: { label: "已批准", className: "overview" },
  borrowed: { label: "借出中", className: "borrowed" },
  return_requested: { label: "待审核归还", className: "pending" },
  returned: { label: "已归还", className: "confirmed" },
  cancelled: { label: "已取消", className: "cancelled" },
};

const nextBorrowStatuses = (status: BorrowOrderStatus): BorrowOrderStatus[] => {
  if (status === "pending") return ["approved", "cancelled"];
  if (status === "approved") return ["borrowed", "cancelled"];
  return [];
};

const activityStatusMeta: Record<ActivityStatus, { label: string; className: string }> = {
  draft: { label: "草稿", className: "overview" },
  active: { label: "启用中", className: "confirmed" },
  archived: { label: "已归档", className: "cancelled" },
};

const selectionTitle = (selection: Selection) => {
  if (selection === "ALL") return "全部物品";
  if (selection === "PENDING") return "待分层物品";
  if (isShelf(selection)) return `${selection} 货架`;
  return locationLabel(selection);
};

const defaultCreateLocation = (selection: Selection) => {
  if (locations.some((location) => location.code === selection)) return selection;
  if (isShelf(selection)) return `${selection}1`;
  if (selection === "PENDING") return "PENDING_A";
  return "A1";
};

function LocationSelect({ defaultValue }: { defaultValue: string }) {
  const groups = useMemo(() => Array.from(new Set(locations.map((location) => location.group))), []);
  return (
    <select name="locationCode" defaultValue={defaultValue} required>
      {groups.map((group) => (
        <optgroup key={group} label={group}>
          {locations.filter((location) => location.group === group).map((location) => (
            <option key={location.code} value={location.code}>{location.label}</option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

function App() {
  const { client, session, profile } = useAuth();
  const location = useLocation();
  const isSuperAdmin = profile?.role === "super_admin";
  const isAdmin = profile?.role === "admin";
  const canManageUsers = isSuperAdmin || isAdmin;
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [history, setHistory] = useState<LocationHistory[]>([]);
  const [requests, setRequests] = useState<InventoryChangeRequest[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [announcements, setAnnouncements] = useState<DbAnnouncementRow[]>([]);
  const [managedUsers, setManagedUsers] = useState<ManagedUser[]>([]);
  const [borrowOrders, setBorrowOrders] = useState<BorrowOrder[]>([]);
  const [borrowItems, setBorrowItems] = useState<DbBorrowItemRow[]>([]);
  const [borrowSummaries, setBorrowSummaries] = useState<DbBorrowSummaryRow[]>([]);
  const [borrowReturnRequests, setBorrowReturnRequests] = useState<DbBorrowReturnRequestRow[]>([]);
  const [borrowReturnItems, setBorrowReturnItems] = useState<DbBorrowReturnItemRow[]>([]);
  const [returnPhotoUrls, setReturnPhotoUrls] = useState<Record<string, string>>({});
  const [returnFeatureReady, setReturnFeatureReady] = useState(true);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [view, setView] = useState<AppView>(() => {
    const requestedView = (location.state as { view?: AppView } | null)?.view;
    return requestedView ?? "inventory";
  });
  const [selection, setSelection] = useState<Selection>("ALL");
  const [query, setQuery] = useState("");
  const [editor, setEditor] = useState<{ mode: EditorMode; item?: InventoryItem } | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [departmentEditor, setDepartmentEditor] = useState<{ mode: EditorMode; department?: Department } | null>(null);
  const [deleteDepartmentId, setDeleteDepartmentId] = useState<number | null>(null);
  const [userEditor, setUserEditor] = useState<ManagedUser | null>(null);
  const [borrowEditorOpen, setBorrowEditorOpen] = useState(false);
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());
  const [activityEditor, setActivityEditor] = useState<{ mode: EditorMode; activity?: Activity } | null>(null);
  const [announcementEditor, setAnnouncementEditor] = useState<DbAnnouncementRow | "create" | null>(null);
  const [deleteAnnouncementId, setDeleteAnnouncementId] = useState<number | null>(null);
  const [deleteActivityId, setDeleteActivityId] = useState<number | null>(null);
  const [borrowStatusFilter, setBorrowStatusFilter] = useState<"all" | BorrowOrderStatus>("all");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [selectedImage, setSelectedImage] = useState<File | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [returnEditorOrderId, setReturnEditorOrderId] = useState<number | null>(null);
  const [returnPhotoFiles, setReturnPhotoFiles] = useState<Record<number, File | null>>({});
  const [returnLocationChecks, setReturnLocationChecks] = useState<Record<number, boolean>>({});
  const [scannedLocations, setScannedLocations] = useState<Record<number, string>>({});
  const [scanLineId, setScanLineId] = useState<number | null>(null);
  const [scanPayload, setScanPayload] = useState("");
  const [scanError, setScanError] = useState<string | null>(null);
  const scanVideoRef = useRef<HTMLVideoElement>(null);
  const scanStreamRef = useRef<MediaStream | null>(null);
  const [returnReviewRequestId, setReturnReviewRequestId] = useState<number | null>(null);
  const [returnReviewNote, setReturnReviewNote] = useState("");
  const imageInputRef = useRef<HTMLInputElement>(null);

  const loadData = useCallback(async () => {
    if (!client || !profile) return;
    setLoading(true);
    setError(null);

    const [itemsResult, historyResult, requestsResult, departmentsResult, activitiesResult, usersResult, ordersResult, orderItemsResult, borrowSummaryResult, returnRequestsResult, returnItemsResult, announcementsResult] = await Promise.all([
      client.from("inventory_items").select("*").order("id"),
      client.from("inventory_location_history").select("*").order("moved_at", { ascending: false }),
      client.from("inventory_change_requests").select("*").order("created_at", { ascending: false }),
      client.from("departments").select("id, name, description, created_at").order("name"),
      client.from("activities").select("id, name, description, department_id, status, start_date, end_date, created_by, created_at, updated_at").order("created_at", { ascending: false }),
      client.from("users").select("id, student_id, name, department_id, phone, email, position, notes, role, is_active, auth_user_id, created_at").order("name"),
      client.from("borrow_orders").select("*").order("created_at", { ascending: false }),
      client.from("borrow_items").select("*").order("id"),
      client.rpc("get_inventory_borrow_status", { p_item_ids: null }),
      client.from("borrow_return_requests").select("id, order_id, user_id, status, submitted_at, reviewed_by, reviewed_at, review_note, notes").order("submitted_at", { ascending: false }),
      client.from("borrow_return_items").select("id, return_request_id, borrow_item_id, item_id, original_location_code, returned_location_code, photo_path, item_condition, notes, created_at").order("id"),
      client.from("system_announcements").select("id, title, content, target_role, is_active, starts_at, ends_at, created_by, created_at, updated_at").order("created_at", { ascending: false }),
    ]);

    const firstError = itemsResult.error ?? historyResult.error ?? requestsResult.error ?? departmentsResult.error
      ?? usersResult.error ?? ordersResult.error ?? orderItemsResult.error;
    if (firstError) {
      setError(firstError.message);
    } else {
      setItems(((itemsResult.data ?? []) as DbInventoryRow[]).map(mapItem));
      setHistory(((historyResult.data ?? []) as DbHistoryRow[]).map(mapHistory));
      setRequests(((requestsResult.data ?? []) as DbRequestRow[]).map(mapRequest));
      setDepartments(((departmentsResult.data ?? []) as DbDepartmentRow[]).map(mapDepartment));
      setActivities(((activitiesResult.data ?? []) as DbActivityRow[]).map(mapActivity));
      setAnnouncements((announcementsResult.data ?? []) as DbAnnouncementRow[]);
      setManagedUsers(((usersResult.data ?? []) as DbUserRow[]).map(mapUser));
      setBorrowOrders(((ordersResult.data ?? []) as DbBorrowOrderRow[]).map(mapBorrowOrder));
      setBorrowItems((orderItemsResult.data ?? []) as DbBorrowItemRow[]);
      setBorrowSummaries((borrowSummaryResult.data ?? []) as DbBorrowSummaryRow[]);
      const returnSchemaReady = !returnRequestsResult.error && !returnItemsResult.error;
      setReturnFeatureReady(returnSchemaReady);
      const loadedReturnItems = (returnItemsResult.data ?? []) as DbBorrowReturnItemRow[];
      setBorrowReturnRequests((returnRequestsResult.data ?? []) as DbBorrowReturnRequestRow[]);
      setBorrowReturnItems(loadedReturnItems);
      if (returnSchemaReady) {
        const photoPaths = Array.from(new Set(loadedReturnItems.map((entry) => entry.photo_path).filter((path): path is string => Boolean(path))));
        if (photoPaths.length > 0) {
          const { data: signedPhotos } = await client.storage.from(RETURN_IMAGE_BUCKET).createSignedUrls(photoPaths, 3600);
          setReturnPhotoUrls(Object.fromEntries((signedPhotos ?? []).filter((entry) => entry.signedUrl).map((entry) => [entry.path, entry.signedUrl])));
        } else {
          setReturnPhotoUrls({});
        }
      } else {
        setReturnPhotoUrls({});
      }
      if (activitiesResult.error) {
        setNotice("库存已加载；活动、批量借用和借出详情需要先执行新的 Supabase 迁移脚本。");
      } else if (!returnSchemaReady) {
        setNotice("借用状态已加载；归还申请功能需要先执行新的归还迁移脚本。");
      }
    }
    setLoading(false);
  }, [client, profile]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    if (!selectedImage) {
      setImagePreviewUrl(null);
      return;
    }
    const objectUrl = URL.createObjectURL(selectedImage);
    setImagePreviewUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [selectedImage]);

  useEffect(() => {
    setSelectedImage(null);
  }, [editor?.mode, editor?.item?.id]);

  useEffect(() => {
    if (!mobileNavOpen || !window.matchMedia("(max-width: 900px)").matches) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileNavOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [mobileNavOpen]);

  useEffect(() => {
    if (scanLineId === null) return;
    let stopped = false;
    const startScanner = async () => {
      setScanError(null);
      if (!navigator.mediaDevices?.getUserMedia) {
        setScanError("当前浏览器不支持摄像头扫码，请在下方输入二维码内容。 ");
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
        if (stopped) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        scanStreamRef.current = stream;
        if (scanVideoRef.current) {
          scanVideoRef.current.srcObject = stream;
          await scanVideoRef.current.play();
        }
        const Detector = (window as Window & { BarcodeDetector?: new (options?: { formats?: string[] }) => { detect: (source: HTMLVideoElement) => Promise<Array<{ rawValue?: string }>> } }).BarcodeDetector;
        if (!Detector) {
          setScanError("当前浏览器没有 QR 扫码 API，请在下方输入二维码内容。");
          return;
        }
        const detector = new Detector({ formats: ["qr_code"] });
        while (!stopped && scanLineId !== null && scanVideoRef.current) {
          const results = await detector.detect(scanVideoRef.current);
          const value = results[0]?.rawValue;
          if (value) {
            setScanPayload(value);
            break;
          }
          await new Promise((resolve) => window.setTimeout(resolve, 250));
        }
      } catch (scannerError) {
        if (!stopped) setScanError(errorMessage(scannerError));
      }
    };
    void startScanner();
    return () => {
      stopped = true;
      scanStreamRef.current?.getTracks().forEach((track) => track.stop());
      scanStreamRef.current = null;
      if (scanVideoRef.current) scanVideoRef.current.srcObject = null;
    };
  }, [scanLineId]);

  const counts = useMemo(() => {
    const byLocation = new Map<string, number>();
    items.forEach((item) => byLocation.set(item.locationCode, (byLocation.get(item.locationCode) ?? 0) + 1));
    return byLocation;
  }, [items]);

  const visibleItems = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("zh-CN");
    return items.filter((item) => matchesSelection(item, selection)).filter((item) =>
      !needle || item.name.toLocaleLowerCase("zh-CN").includes(needle) || item.id.toLowerCase().includes(needle) ||
      item.specification.toLocaleLowerCase("zh-CN").includes(needle) || item.imageName.toLocaleLowerCase("zh-CN").includes(needle) ||
      locationLabel(item.locationCode).toLocaleLowerCase("zh-CN").includes(needle),
    );
  }, [items, query, selection]);

  const borrowSummaryByItem = useMemo(
    () => new Map(borrowSummaries.map((summary) => [summary.item_id, summary])),
    [borrowSummaries],
  );
  const activeActivities = useMemo(() => activities.filter((activity) => activity.status === "active"), [activities]);
  const selectedItems = useMemo(
    () => items.filter((item) => selectedItemIds.has(item.id) && !borrowSummaryByItem.has(item.id)),
    [borrowSummaryByItem, items, selectedItemIds],
  );
  const selectedVisibleCount = visibleItems.filter((item) => selectedItemIds.has(item.id) && !borrowSummaryByItem.has(item.id)).length;

  const pendingLocationCount = items.filter((item) => isPendingLocation(item.locationCode)).length;
  const reviewCount = items.filter((item) => item.status === "pending").length;
  const pendingRequestCount = requests.filter((request) => request.status === "pending").length;
  const pendingBorrowCount = borrowOrders.filter((order) => order.status === "pending").length;
  const memberBorrowOrders = borrowOrders.filter((order) => order.userId === profile?.id);
  const outstandingBorrowOrders = memberBorrowOrders.filter((order) => ["borrowed", "return_requested"].includes(order.status));
  const outstandingBorrowItemCount = borrowItems
    .filter((line) => outstandingBorrowOrders.some((order) => order.id === line.order_id))
    .reduce((total, line) => total + Math.max(0, line.quantity_borrowed - line.quantity_returned), 0);
  const memberBorrowActionCount = memberBorrowOrders.filter((order) => ["pending", "approved", "borrowed", "return_requested"].includes(order.status)).length;
  const borrowReturnRequestByOrder = useMemo(() => {
    const result = new Map<number, DbBorrowReturnRequestRow>();
    borrowReturnRequests.forEach((request) => {
      if (!result.has(request.order_id)) result.set(request.order_id, request);
    });
    return result;
  }, [borrowReturnRequests]);
  const returnItemsByRequest = useMemo(() => {
    const result = new Map<number, DbBorrowReturnItemRow[]>();
    borrowReturnItems.forEach((item) => {
      const current = result.get(item.return_request_id) ?? [];
      current.push(item);
      result.set(item.return_request_id, current);
    });
    return result;
  }, [borrowReturnItems]);
  const selectedDetail = items.find((item) => item.id === detailId) ?? null;
  const returnEditorOrder = borrowOrders.find((order) => order.id === returnEditorOrderId) ?? null;
  const returnItemsForOrder = returnEditorOrder
    ? borrowItems.filter((line) => line.order_id === returnEditorOrder.id && line.quantity_returned < line.quantity_borrowed)
    : [];
  const returnReviewRequest = borrowReturnRequests.find((request) => request.id === returnReviewRequestId) ?? null;
  const returnReviewItems = returnReviewRequest ? (returnItemsByRequest.get(returnReviewRequest.id) ?? []) : [];
  const visibleManagedUsers = isSuperAdmin ? managedUsers : managedUsers.filter((user) => user.role === "member");
  const visibleBorrowOrders = borrowStatusFilter === "all"
    ? borrowOrders
    : borrowOrders.filter((order) => order.status === borrowStatusFilter);

  const departmentName = (departmentId: number | null) =>
    departments.find((department) => department.id === departmentId)?.name ?? "未分配";

  const userName = (userId: number) => managedUsers.find((user) => user.id === userId)?.name
    ?? (profile?.id === userId ? profile.name : `用户 #${userId}`);

  const activityName = (activityId: number | null) =>
    activities.find((activity) => activity.id === activityId)?.name ?? "未关联活动";

  const canManageActivity = (activity: Activity) =>
    isSuperAdmin || (isAdmin && profile?.departmentId !== null && activity.departmentId === profile?.departmentId);

  const borrowSummary = (itemId: string) => borrowSummaryByItem.get(itemId) ?? null;

  const toggleItemSelection = (itemId: string) => {
    if (borrowSummaryByItem.has(itemId)) return;
    setSelectedItemIds((current) => {
      const next = new Set(current);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  };

  const toggleVisibleSelection = () => {
    const availableVisibleIds = visibleItems.filter((item) => !borrowSummaryByItem.has(item.id)).map((item) => item.id);
    setSelectedItemIds((current) => {
      const next = new Set(current);
      const shouldSelect = availableVisibleIds.some((id) => !next.has(id));
      availableVisibleIds.forEach((id) => {
        if (shouldSelect) next.add(id);
        else next.delete(id);
      });
      return next;
    });
  };

  const orderItemSummary = (orderId: number) => {
    const lines = borrowItems.filter((line) => line.order_id === orderId);
    if (lines.length === 0) return "未读取到借用明细";
    return lines.map((line) => {
      const item = items.find((candidate) => candidate.id === line.item_id);
      return `${item?.name ?? line.item_id} x ${line.quantity_borrowed}`;
    }).join("、");
  };

  const isOverdue = (order: BorrowOrder) => Boolean(
    order.expectedReturnDate
    && !["returned", "cancelled"].includes(order.status)
    && new Date(`${order.expectedReturnDate}T23:59:59`).getTime() < Date.now(),
  );

  const originalLocationForLine = (line: DbBorrowItemRow) =>
    line.borrow_location_code ?? items.find((item) => item.id === line.item_id)?.locationCode ?? "A1";

  const selectLocation = (value: Selection) => {
    setSelection(value);
    setView("inventory");
    setMobileNavOpen(false);
  };

  const handleImageSelection = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0] ?? null;
    if (!file) {
      setSelectedImage(null);
      return;
    }
    const validationError = validateImageFile(file);
    if (validationError) {
      event.currentTarget.value = "";
      setSelectedImage(null);
      setError(validationError);
      return;
    }
    setError(null);
    setSelectedImage(file);
  };

  const clearSelectedImage = () => {
    setSelectedImage(null);
    if (imageInputRef.current) imageInputRef.current.value = "";
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!client || !profile || !editor) return;
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") ?? "").trim();
    const locationCode = String(form.get("locationCode") ?? "PENDING_A");
    const specification = String(form.get("specification") ?? "").trim();
    const quantity = String(form.get("quantity") ?? "若干").trim() || "若干";
    let imageName = String(form.get("imageName") ?? "").trim();
    let imagePath = String(form.get("imagePath") ?? "").trim();
    const recognitionStatus = String(form.get("recognitionStatus") ?? "已确认").trim() || "已确认";
    const reason = String(form.get("reason") ?? "").trim();
    if (!name) return;

    if (selectedImage) {
      const validationError = validateImageFile(selectedImage);
      if (validationError) {
        setError(validationError);
        return;
      }
    }

    setSubmitting(true);
    setError(null);
    setNotice(null);
    let uploadedFilePath: string | null = null;
    let succeeded = false;
    try {
      if (selectedImage) {
        if (!session?.user.id) throw new Error("登录状态已失效，请重新登录后上传。");
        const fileName = storageFileName(name, selectedImage);
        uploadedFilePath = `inventory/${session.user.id}/${fileName}`;
        const { error: uploadError } = await client.storage
          .from(IMAGE_BUCKET)
          .upload(uploadedFilePath, selectedImage, {
            cacheControl: "3600",
            contentType: selectedImage.type,
            upsert: false,
          });

        if (uploadError) {
          const uploadMessage = uploadError.message.includes("Bucket not found")
            ? "图片存储尚未配置，请管理员先在 Supabase SQL Editor 执行 supabase/storage_images.sql。"
            : uploadError.message.includes("row-level security")
              ? "当前账号没有图片上传权限，请检查 Storage RLS 策略和账号启用状态。"
              : `图片上传失败：${uploadError.message}`;
          throw new Error(uploadMessage);
        }
        const { data: urlData } = client.storage.from(IMAGE_BUCKET).getPublicUrl(uploadedFilePath);
        imageName = fileName;
        imagePath = urlData.publicUrl;
      }

      if (isSuperAdmin) {
        const result = editor.mode === "create"
          ? await client.rpc("create_inventory_item", {
              p_name: name, p_location_code: locationCode, p_quantity: quantity, p_specification: specification,
              p_image_name: imageName, p_image_path: imagePath, p_recognition_status: recognitionStatus,
            })
          : await client.rpc("update_inventory_item", {
              p_item_id: editor.item!.id, p_name: name, p_location_code: locationCode, p_quantity: quantity,
              p_specification: specification, p_image_name: imageName, p_image_path: imagePath,
              p_recognition_status: recognitionStatus,
            });
        if (result.error) throw result.error;
        succeeded = true;
        setNotice(editor.mode === "create" ? "物品已创建并写入正式库存。" : "正式库存已更新。");
      } else {
        const { error: requestError } = await client.from("inventory_change_requests").insert({
          request_type: editor.mode === "create" ? "create" : "update",
          item_id: editor.item?.id ?? null,
          proposed_name: name,
          proposed_location_code: locationCode,
          proposed_specification: specification,
          proposed_quantity: quantity,
          proposed_image_name: imageName,
          proposed_image_path: imagePath,
          proposed_recognition_status: recognitionStatus,
          reason: reason || null,
          requested_by: profile.id,
        });
        if (requestError) throw requestError;
        succeeded = true;
        setNotice("变更请求已提交，批准前不会影响正式库存。");
      }
    } catch (submitError) {
      let cleanupFailed = false;
      if (uploadedFilePath) {
        const { error: cleanupError } = await client.storage.from(IMAGE_BUCKET).remove([uploadedFilePath]);
        cleanupFailed = Boolean(cleanupError);
      }
      setError(`${errorMessage(submitError)}${cleanupFailed ? " 已上传的临时图片未能自动清理，请联系管理员。" : ""}`);
    } finally {
      setSubmitting(false);
    }

    if (succeeded) {
      setEditor(null);
      await loadData();
    }
  };

  const confirmDelete = async () => {
    if (!client || !profile || !deleteId) return;
    setSubmitting(true);
    setError(null);
    setNotice(null);
    let succeeded = false;
    if (isSuperAdmin) {
      const { error: deleteError } = await client.rpc("delete_inventory_item", { p_item_id: deleteId });
      if (deleteError) setError(deleteError.message);
      else {
        succeeded = true;
        setNotice("物品已从正式库存删除，编号不会重新分配。");
      }
    } else {
      const { error: requestError } = await client.from("inventory_change_requests").insert({
        request_type: "delete",
        item_id: deleteId,
        reason: "申请删除物品",
        requested_by: profile.id,
      });
      if (requestError) setError(requestError.message);
      else {
        succeeded = true;
        setNotice("删除请求已提交，批准前物品仍保留在正式库存中。");
      }
    }
    setSubmitting(false);
    if (succeeded) {
      setDeleteId(null);
      setDetailId(null);
      await loadData();
    }
  };

  const reviewRequest = async (requestId: number, approve: boolean) => {
    if (!client || !isSuperAdmin) return;
    setSubmitting(true);
    setError(null);
    setNotice(null);
    const { error: reviewError } = await client.rpc("review_inventory_change_request", {
      p_request_id: requestId,
      p_approve: approve,
      p_review_note: approve ? "批准" : "拒绝",
    });
    if (reviewError) setError(reviewError.message);
    else setNotice(approve ? "请求已批准，正式库存已同步。" : "请求已拒绝，正式库存未改变。");
    setSubmitting(false);
    if (!reviewError) await loadData();
  };

  const handleUserSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!client || !profile || !userEditor || !canManageUsers) return;
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") ?? "").trim();
    const phone = String(form.get("phone") ?? "").trim();
    const position = String(form.get("position") ?? "").trim();
    const notes = String(form.get("notes") ?? "").trim();
    const isActive = form.get("isActive") === "on";
    if (!name) return;

    setSubmitting(true);
    setError(null);
    setNotice(null);
    const result = isSuperAdmin
      ? await client.from("users").update({
          name,
          student_id: String(form.get("studentId") ?? "").trim() || null,
          phone: phone || null,
          email: String(form.get("email") ?? "").trim() || null,
          position: position || null,
          notes: notes || null,
          role: String(form.get("role") ?? userEditor.role),
          department_id: String(form.get("departmentId") ?? "") ? Number(form.get("departmentId")) : null,
          is_active: isActive,
        }).eq("id", userEditor.id)
      : await client.rpc("update_department_member", {
          p_user_id: userEditor.id,
          p_name: name,
          p_phone: phone || null,
          p_position: position || null,
          p_notes: notes || null,
          p_is_active: isActive,
        });
    setSubmitting(false);
    if (result.error) {
      setError(result.error.message);
      return;
    }
    setNotice("人员资料已更新。");
    setUserEditor(null);
    await loadData();
  };

  const handleBorrowSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!client || !profile || selectedItems.length === 0) return;
    const form = new FormData(event.currentTarget);
    const requestItems = selectedItems.map((item) => ({
      item_id: item.id,
      quantity: Math.max(1, Number(form.get(`quantity_${item.id}`) ?? 1) || 1),
    }));
    setSubmitting(true);
    setError(null);
    setNotice(null);
    const { error: createError } = await client.rpc("create_borrow_order_batch", {
      p_items: requestItems,
      p_reason: String(form.get("reason") ?? "").trim(),
      p_expected_return_date: String(form.get("expectedReturnDate") ?? ""),
      p_notes: String(form.get("notes") ?? "").trim() || null,
      p_activity_id: String(form.get("activityId") ?? "") ? Number(form.get("activityId")) : null,
    });
    setSubmitting(false);
    if (createError) {
      setError(createError.message);
      return;
    }
    setNotice("借用申请已提交，等待管理员审批。");
    setBorrowEditorOpen(false);
    setSelectedItemIds(new Set());
    setView("borrows");
    await loadData();
  };

  const handleReturnPhotoSelection = (borrowItemId: number, event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0] ?? null;
    if (!file) {
      setReturnPhotoFiles((current) => ({ ...current, [borrowItemId]: null }));
      return;
    }
    const validationError = validateImageFile(file);
    if (validationError) {
      event.currentTarget.value = "";
      setError(validationError);
      return;
    }
    setError(null);
    setReturnPhotoFiles((current) => ({ ...current, [borrowItemId]: file }));
  };

  const openReturnEditor = (orderId: number) => {
    if (!returnFeatureReady) {
      setError("归还申请功能尚未部署，请管理员先执行新的归还迁移脚本。");
      return;
    }
    const order = borrowOrders.find((candidate) => candidate.id === orderId);
    if (!order || order.status !== "borrowed") return;
    setReturnPhotoFiles({});
    setReturnLocationChecks({});
    setScannedLocations({});
    setReturnEditorOrderId(orderId);
  };

  const confirmShelfScan = (line: DbBorrowItemRow, payload: string) => {
    const scannedCode = payload.trim().replace(/^513-warehouse:/i, "").toUpperCase();
    const expectedCode = originalLocationForLine(line).toUpperCase();
    if (scannedCode !== expectedCode) {
      setScanError(`二维码对应 ${locationLabel(scannedCode)}，但这件物品借出前位于 ${locationLabel(expectedCode)}。`);
      return;
    }
    setScannedLocations((current) => ({ ...current, [line.id]: scannedCode }));
    setReturnLocationChecks((current) => ({ ...current, [line.id]: true }));
    setScanPayload("");
    setScanError(null);
    setScanLineId(null);
    setNotice(`${locationLabel(expectedCode)} 二维码验证通过。`);
  };

  const handleReturnSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!client || !session?.user.id || !profile || !returnEditorOrder || returnItemsForOrder.length === 0) return;
    const form = new FormData(event.currentTarget);
    const missingLocation = returnItemsForOrder.find((line) => !returnLocationChecks[line.id] || scannedLocations[line.id] !== originalLocationForLine(line));
    if (missingLocation) {
      setError("每件归还物品都必须扫描对应货架二维码，并验证其与借出前原位一致。");
      return;
    }

    setSubmitting(true);
    setError(null);
    setNotice(null);
    const uploadedPaths: string[] = [];
    try {
      const requestItems: Array<{
        borrow_item_id: number;
        returned_location_code: string;
        photo_path: string | null;
        item_condition: "good" | "damaged" | "lost";
        notes: string | null;
      }> = [];

      for (const line of returnItemsForOrder) {
        const photo = returnPhotoFiles[line.id];
        let path: string | null = null;
        if (photo) {
          const fileName = storageFileName(line.item_id, photo);
          path = `returns/${session.user.id}/${returnEditorOrder.id}/${line.id}_${fileName}`;
          const { error: uploadError } = await client.storage.from(RETURN_IMAGE_BUCKET).upload(path, photo, {
            cacheControl: "3600",
            contentType: photo.type,
            upsert: false,
          });
          if (uploadError) {
            const uploadMessage = uploadError.message.includes("Bucket not found")
              ? "归还照片存储尚未配置，请管理员先执行新的归还迁移脚本。"
              : uploadError.message.includes("row-level security")
                ? "当前账号没有归还照片上传权限，请检查 Storage RLS 策略。"
                : `归还照片上传失败：${uploadError.message}`;
            throw new Error(uploadMessage);
          }
          uploadedPaths.push(path);
        }
        requestItems.push({
          borrow_item_id: line.id,
          returned_location_code: scannedLocations[line.id] ?? originalLocationForLine(line),
          photo_path: path,
          item_condition: String(form.get(`condition_${line.id}`) ?? "good") as "good" | "damaged" | "lost",
          notes: String(form.get(`returnNote_${line.id}`) ?? "").trim() || null,
        });
      }

      const { error: submitError } = await client.rpc("submit_borrow_return_request", {
        p_order_id: returnEditorOrder.id,
        p_items: requestItems,
        p_notes: String(form.get("returnNotes") ?? "").trim() || null,
      });
      if (submitError) throw new Error(submitError.message);

      setNotice("归还申请已提交，服务器已记录精确到秒的提交时间，等待管理员核验。");
      setReturnEditorOrderId(null);
      setReturnPhotoFiles({});
      setReturnLocationChecks({});
      setScannedLocations({});
      setView("borrows");
      await loadData();
    } catch (returnError) {
      if (uploadedPaths.length > 0) {
        await client.storage.from(RETURN_IMAGE_BUCKET).remove(uploadedPaths);
      }
      setError(errorMessage(returnError));
    } finally {
      setSubmitting(false);
    }
  };

  const reviewReturnRequest = async (requestId: number, approve: boolean) => {
    if (!client || (!isSuperAdmin && !isAdmin)) return;
    setSubmitting(true);
    setError(null);
    setNotice(null);
    const { error: reviewError } = await client.rpc("review_borrow_return_request", {
      p_return_request_id: requestId,
      p_approve: approve,
      p_review_note: returnReviewNote.trim() || null,
    });
    setSubmitting(false);
    if (reviewError) {
      setError(reviewError.message);
      return;
    }
    setNotice(approve ? "归还申请已核验，库存已恢复为原位。" : "归还申请已驳回，用户可重新提交。");
    setReturnReviewRequestId(null);
    setReturnReviewNote("");
    await loadData();
  };

  const openBorrowEditor = () => {
    if (selectedItems.length === 0) {
      setView("inventory");
      setNotice("请先在库存列表勾选要借用的物品，再填写借用单。");
      return;
    }
    setBorrowEditorOpen(true);
  };

  const handleExport = async () => {
    if (selectedItems.length === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      const { default: ExcelJS } = await import("exceljs");
      const workbook = new ExcelJS.Workbook();
      workbook.creator = "513 仓库物品管理台";
      const worksheet = workbook.addWorksheet("库存物品");
      worksheet.columns = [
        { header: "物品名称", key: "name", width: 28 },
        { header: "物品编号", key: "id", width: 18 },
        { header: "物品位置", key: "location", width: 24 },
      ];
      selectedItems.forEach((item) => worksheet.addRow({
        name: item.name,
        id: item.id,
        location: locationLabel(item.locationCode),
      }));
      worksheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
      worksheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF18352D" } };
      worksheet.views = [{ state: "frozen", ySplit: 1 }];
      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `513仓库物品清单_${new Date().toISOString().slice(0, 10)}.xlsx`;
      link.click();
      URL.revokeObjectURL(url);
      setNotice(`已导出 ${selectedItems.length} 件物品，不包含图片。`);
    } catch (exportError) {
      setError(`导出失败：${errorMessage(exportError)}`);
    } finally {
      setSubmitting(false);
    }
  };

  const updateBorrowStatus = async (orderId: number, status: BorrowOrderStatus) => {
    if (!client || (!isSuperAdmin && !isAdmin)) return;
    setSubmitting(true);
    setError(null);
    setNotice(null);
    const { error: updateError } = await client.rpc("update_borrow_order_status", {
      p_order_id: orderId,
      p_status: status,
      p_notes: null,
    });
    setSubmitting(false);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    setNotice("借用订单状态已更新。");
    await loadData();
  };

  const handleDepartmentSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!client || !isSuperAdmin || !departmentEditor) return;
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") ?? "").trim();
    const description = String(form.get("description") ?? "").trim();
    if (!name) return;

    setSubmitting(true);
    setError(null);
    setNotice(null);
    const result = departmentEditor.mode === "create"
      ? await client.from("departments").insert({ name, description: description || null })
      : await client.from("departments").update({ name, description: description || null }).eq("id", departmentEditor.department!.id);
    setSubmitting(false);

    if (result.error) {
      setError(result.error.code === "23505" ? "部门名称已存在，请使用其他名称。" : result.error.message);
      return;
    }

    setNotice(departmentEditor.mode === "create" ? "部门已新增。" : "部门信息已更新。");
    setDepartmentEditor(null);
    await loadData();
  };

  const confirmDepartmentDelete = async () => {
    if (!client || !isSuperAdmin || deleteDepartmentId === null) return;
    setSubmitting(true);
    setError(null);
    setNotice(null);
    const { error: deleteError } = await client.from("departments").delete().eq("id", deleteDepartmentId);
    setSubmitting(false);

    if (deleteError) {
      setError(deleteError.message);
      return;
    }

    setNotice("部门已删除，原有关联用户和历史订单已改为未分配部门。");
    setDeleteDepartmentId(null);
    await loadData();
  };

  const handleActivitySubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!client || !profile || (!isSuperAdmin && !isAdmin) || !activityEditor) return;
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") ?? "").trim();
    const description = String(form.get("description") ?? "").trim();
    const status = String(form.get("status") ?? "active") as ActivityStatus;
    const startDate = String(form.get("startDate") ?? "") || null;
    const endDate = String(form.get("endDate") ?? "") || null;
    const departmentId = isSuperAdmin
      ? (String(form.get("departmentId") ?? "") ? Number(form.get("departmentId")) : null)
      : profile.departmentId;
    if (!name) return;
    setSubmitting(true);
    setError(null);
    setNotice(null);
    const payload = {
      name,
      description: description || null,
      department_id: departmentId,
      status,
      start_date: startDate,
      end_date: endDate,
    };
    const result = activityEditor.mode === "create"
      ? await client.from("activities").insert({ ...payload, created_by: profile.id })
      : await client.from("activities").update(payload).eq("id", activityEditor.activity!.id);
    setSubmitting(false);
    if (result.error) {
      setError(result.error.code === "23505" ? "活动名称已存在，请使用其他名称。" : result.error.message);
      return;
    }
    setNotice(activityEditor.mode === "create" ? "活动已创建。" : "活动信息已更新。");
    setActivityEditor(null);
    await loadData();
  };

  const confirmActivityDelete = async () => {
    if (!client || (!isSuperAdmin && !isAdmin) || deleteActivityId === null) return;
    setSubmitting(true);
    setError(null);
    setNotice(null);
    const { error: deleteError } = await client.from("activities").delete().eq("id", deleteActivityId);
    setSubmitting(false);
    if (deleteError) {
      setError(deleteError.message);
      return;
    }
    setDeleteActivityId(null);
    setNotice("活动已删除，历史借用订单仍会保留。");
    await loadData();
  };

  const handleAnnouncementSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!client || !profile || !isSuperAdmin || !announcementEditor) return;
    const form = new FormData(event.currentTarget);
    const title = String(form.get("title") ?? "").trim();
    const content = String(form.get("content") ?? "").trim();
    if (!title || !content) return;
    setSubmitting(true);
    setError(null);
    setNotice(null);
    const payload = {
      title,
      content,
      target_role: String(form.get("targetRole") ?? "") || null,
      is_active: form.get("isActive") === "on",
      starts_at: String(form.get("startsAt") ?? "") || new Date().toISOString(),
      ends_at: String(form.get("endsAt") ?? "") || null,
    };
    const result = announcementEditor === "create"
      ? await client.from("system_announcements").insert({ ...payload, created_by: profile.id })
      : await client.from("system_announcements").update(payload).eq("id", announcementEditor.id);
    setSubmitting(false);
    if (result.error) {
      setError(result.error.message);
      return;
    }
    setAnnouncementEditor(null);
    setNotice(announcementEditor === "create" ? "公告已发布。" : "公告已更新。");
    await loadData();
  };

  const confirmAnnouncementDelete = async () => {
    if (!client || !isSuperAdmin || deleteAnnouncementId === null) return;
    setSubmitting(true);
    const { error: deleteError } = await client.from("system_announcements").delete().eq("id", deleteAnnouncementId);
    setSubmitting(false);
    if (deleteError) {
      setError(deleteError.message);
      return;
    }
    setDeleteAnnouncementId(null);
    setNotice("公告已删除。");
    await loadData();
  };

  const departmentUsage = (departmentId: number) => ({
    users: managedUsers.filter((user) => user.departmentId === departmentId).length,
    orders: borrowOrders.filter((order) => order.departmentId === departmentId).length,
  });

  const navCount = (code: string) => counts.get(code) ?? 0;

  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="icon-button mobile-menu" onClick={() => setMobileNavOpen((open) => !open)} aria-label={mobileNavOpen ? "关闭位置导航" : "打开位置导航"} aria-expanded={mobileNavOpen} aria-controls="warehouse-navigation" title="位置导航"><Menu size={20} /></button>
        <div className="brand-mark"><Boxes size={20} /></div>
        <div className="brand-copy"><strong>513 仓库</strong><span>物品管理台</span></div>
        <div className="topbar-summary"><span><Box size={16} /> {items.length} 件物品</span>{profile?.role === "member" ? <><span><PackageCheck size={16} /> {memberBorrowActionCount} 个借用流程</span><span><RotateCcw size={16} /> {outstandingBorrowItemCount} 件未归还</span></> : <><span><ClipboardList size={16} /> {pendingRequestCount} 个待审批</span><span><PackageCheck size={16} /> {pendingBorrowCount} 个借用待处理</span></>}</div>
        <span className="account-email" title={session?.user.email}>{profile?.name} · {profile?.role}</span>
        <button className="icon-button sign-out-button" onClick={() => client?.auth.signOut()} aria-label="退出登录" title="退出登录"><LogOut size={18} /></button>
        {profile?.role === "member" ? <button className="primary-button" onClick={() => setView("borrows")}><PackageCheck size={18} /><span>借用状态</span></button> : <button className="primary-button" aria-label={isSuperAdmin ? "新增物品" : "申请新增物品"} onClick={() => { setView("inventory"); setEditor({ mode: "create" }); }}><PackagePlus size={18} /><span>{isSuperAdmin ? "新增物品" : "申请新增"}</span></button>}
      </header>

      <aside id="warehouse-navigation" className={`sidebar ${mobileNavOpen ? "open" : ""}`}>
        <div className="sidebar-header"><span>存放位置</span><button className="icon-button close-nav" onClick={() => setMobileNavOpen(false)} aria-label="关闭导航"><X size={18} /></button></div>
        <nav aria-label="仓库位置">
          <button className={`nav-row ${selection === "ALL" && view === "inventory" ? "active" : ""}`} onClick={() => selectLocation("ALL")}><Archive size={17} /><span>全部物品</span><b>{items.length}</b></button>
          {['A', 'B', 'C', 'D'].map((shelf) => (
            <div className="shelf-group" key={shelf}>
              <button className={`nav-row shelf ${selection === shelf && view === "inventory" ? "active" : ""}`} onClick={() => selectLocation(shelf)}><Layers3 size={17} /><span>{shelf} 货架</span><b>{items.filter((item) => matchesSelection(item, shelf)).length}</b></button>
              <div className="level-grid">{[1, 2, 3, 4].map((level) => { const code = `${shelf}${level}`; return <button key={code} className={selection === code && view === "inventory" ? "active" : ""} onClick={() => selectLocation(code)}><span>{level} 层</span><b>{navCount(code)}</b></button>; })}</div>
            </div>
          ))}
          <div className="nav-divider" />
          <button className={`nav-row ${selection === "FLOOR" && view === "inventory" ? "active" : ""}`} onClick={() => selectLocation("FLOOR")}><MapPin size={17} /><span>地板区域</span><b>{navCount("FLOOR")}</b></button>
          <button className={`nav-row ${selection === "DOOR" && view === "inventory" ? "active" : ""}`} onClick={() => selectLocation("DOOR")}><DoorOpen size={17} /><span>门后区域</span><b>{navCount("DOOR")}</b></button>
          <button className={`nav-row pending-nav ${selection === "PENDING" && view === "inventory" ? "active" : ""}`} onClick={() => selectLocation("PENDING")}><CircleAlert size={17} /><span>待分层</span><b>{pendingLocationCount}</b></button>
          <div className="nav-divider" />
          {profile?.role !== "member" && <button className={`nav-row ${view === "requests" ? "active" : ""}`} onClick={() => { setView("requests"); setMobileNavOpen(false); }}><ClipboardList size={17} /><span>{isSuperAdmin ? "变更审批" : "物品申请"}</span><b>{pendingRequestCount}</b></button>}
          <button className={`nav-row ${view === "borrows" ? "active" : ""}`} onClick={() => { setView("borrows"); setMobileNavOpen(false); }}><PackageCheck size={17} /><span>{profile?.role === "member" ? "借用状态" : "借用监管"}</span><b>{profile?.role === "member" ? memberBorrowActionCount : pendingBorrowCount}</b></button>
          {(isSuperAdmin || isAdmin) && <button className={`nav-row ${view === "activities" ? "active" : ""}`} onClick={() => { setView("activities"); setMobileNavOpen(false); }}><CalendarRange size={17} /><span>活动管理</span><b>{activeActivities.length}</b></button>}
          {isSuperAdmin && <button className={`nav-row ${view === "announcements" ? "active" : ""}`} onClick={() => { setView("announcements"); setMobileNavOpen(false); }}><BellRing size={17} /><span>公告管理</span><b>{announcements.filter((announcement) => announcement.is_active).length}</b></button>}
          {canManageUsers && <button className={`nav-row ${view === "users" ? "active" : ""}`} onClick={() => { setView("users"); setMobileNavOpen(false); }}><UsersRound size={17} /><span>人员管理</span><b>{visibleManagedUsers.length}</b></button>}
          {isSuperAdmin && <button className={`nav-row ${view === "departments" ? "active" : ""}`} onClick={() => { setView("departments"); setMobileNavOpen(false); }}><Building2 size={17} /><span>部门管理</span><b>{departments.length}</b></button>}
        </nav>
      </aside>

      {mobileNavOpen && <button className="nav-backdrop" aria-label="点击关闭位置导航" onClick={() => setMobileNavOpen(false)} />}

      <main className="main-content">
        {notice && <div className="page-notice" role="status"><Check size={17} />{notice}<button onClick={() => setNotice(null)} aria-label="关闭提示"><X size={15} /></button></div>}
        {error && <div className="page-error" role="alert"><CircleAlert size={17} /><span>{error}</span><button onClick={() => setError(null)} aria-label="关闭错误"><X size={15} /></button></div>}

        {view === "inventory" ? (
          <>
            <div className="content-heading">
              <div><p className="eyebrow">正式库存</p><h1>{selectionTitle(selection)}</h1><p>{visibleItems.length} 件匹配物品</p></div>
              {profile?.role === "member" ? <button className="primary-button heading-add" onClick={openBorrowEditor}><ListChecks size={18} />填写借用单</button> : <button className="primary-button heading-add" onClick={() => setEditor({ mode: "create" })}><PackagePlus size={18} />{isSuperAdmin ? "新增" : "申请新增"}</button>}
            </div>

            {profile?.role === "member" && outstandingBorrowOrders.length > 0 && <section className="outstanding-borrow-panel" aria-label="未归还提醒">
              <div className="outstanding-borrow-icon"><RotateCcw size={20} /></div>
              <div className="outstanding-borrow-copy"><strong>您有 {outstandingBorrowItemCount || outstandingBorrowOrders.length} 件物品尚未归还</strong><span>{outstandingBorrowOrders.some((order) => order.status === "return_requested") ? "部分归还申请正在等待管理员核验。" : "请进入借用状态，逐件填写归还申请并扫描对应货架二维码；归还照片可选。"}</span></div>
              <button className="secondary-button compact-button" onClick={() => setView("borrows")}><PackageCheck size={15} />查看借用状态</button>
            </section>}

            <section className="metrics" aria-label="库存概览">
              <div><span>库存总数</span><strong>{items.length}</strong><small>仅含已批准数据</small></div>
              <div><span>正式归位</span><strong>{items.length - pendingLocationCount}</strong><small>A1-D4 / 区域</small></div>
              <div className={pendingLocationCount ? "attention" : ""}><span>待分层</span><strong>{pendingLocationCount}</strong><small>保留原货架线索</small></div>
              <div className={reviewCount ? "attention" : ""}><span>名称待核对</span><strong>{reviewCount}</strong><small>视觉识别待确认</small></div>
            </section>

            <section className="inventory-panel">
              <div className="toolbar">
                <label className="search-box"><Search size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索名称、编号、规格、图片或位置" />{query && <button onClick={() => setQuery("")} aria-label="清除搜索"><X size={16} /></button>}</label>
                <button className="icon-button" onClick={() => void loadData()} aria-label="刷新数据" title="刷新"><RefreshCw size={17} /></button>
                <label className="selection-toggle"><input type="checkbox" checked={visibleItems.some((item) => !borrowSummaryByItem.has(item.id)) && selectedVisibleCount === visibleItems.filter((item) => !borrowSummaryByItem.has(item.id)).length} onChange={toggleVisibleSelection} /><span>全选当前可借物品</span></label>
                <span className="selection-count">已选 {selectedItems.length} 件</span>
                <button className="secondary-button compact-button export-button" onClick={() => void handleExport()} disabled={selectedItems.length === 0 || submitting}><FileSpreadsheet size={15} />导出 XLSX</button>
                <span className="result-count">显示 {visibleItems.length} / {items.length}</span>
              </div>
              <div className="table-wrap">
                <table>
                  <thead><tr><th className="selection-column"><span className="sr-only">选择</span></th><th>物品</th><th>唯一编号</th><th>当前位置</th><th>规格 / 数量</th><th>状态</th><th><span className="sr-only">操作</span></th></tr></thead>
                  <tbody>{visibleItems.map((item) => { const meta = statusMeta(item); return (
                    <tr key={item.id} onClick={() => setDetailId(item.id)}>
                      <td className="selection-cell" onClick={(event) => event.stopPropagation()}><input type="checkbox" checked={selectedItemIds.has(item.id)} disabled={borrowSummaryByItem.has(item.id)} onChange={() => toggleItemSelection(item.id)} aria-label={`选择 ${item.name}`} /></td>
                      <td><div className="item-cell">{item.imagePath ? <img src={assetUrl(item.imagePath)} alt="" /> : <div className="image-placeholder"><Box size={20} /></div>}<div><strong>{item.name}</strong><small>{item.imageName || item.recognitionStatus}</small></div></div></td>
                      <td><code>{item.id}</code></td>
                      <td><span className={`location-pill ${isPendingLocation(item.locationCode) ? "pending" : ""}`}><MapPin size={14} />{locationLabel(item.locationCode)}</span></td>
                      <td><div className="spec-cell"><span>{item.specification || "未填写规格"}</span><strong>{item.quantity}</strong></div></td>
                      <td><div className="status-stack"><span className={`status-badge ${meta.className}`}>{meta.text}</span>{borrowSummaryByItem.has(item.id) && <span className="status-badge borrowed">已借出</span>}</div></td>
                      <td className="action-cell">{profile?.role !== "member" && <button className="icon-button" onClick={(event) => { event.stopPropagation(); setEditor({ mode: "edit", item }); }} aria-label={`${isSuperAdmin ? "编辑" : "申请修改"} ${item.name}`} title={isSuperAdmin ? "编辑" : "申请修改"}><Edit3 size={17} /></button>}<button className="icon-button more" onClick={(event) => { event.stopPropagation(); setDetailId(item.id); }} aria-label={`查看 ${item.name}`} title="查看详情"><MoreHorizontal size={18} /></button></td>
                    </tr>
                  ); })}</tbody>
                </table>
                {!loading && visibleItems.length === 0 && <div className="empty-state"><Search size={26} /><strong>没有匹配的物品</strong><span>调整位置筛选或搜索内容</span></div>}
                {loading && <div className="empty-state"><RefreshCw className="spin" size={24} /><strong>正在读取正式库存</strong></div>}
              </div>
            </section>
          </>
        ) : view === "requests" ? (
          <>
            <div className="content-heading"><div><p className="eyebrow">数据请求</p><h1>{isSuperAdmin ? "变更审批" : "我的申请"}</h1><p>{pendingRequestCount} 个待处理请求</p></div><button className="secondary-button" onClick={() => void loadData()}><RefreshCw size={17} />刷新</button></div>
            <section className="inventory-panel request-panel">
              <div className="table-wrap"><table>
                <thead><tr><th>请求</th><th>目标</th><th>建议数据</th><th>提交时间</th><th>状态</th>{isSuperAdmin && <th>审批</th>}</tr></thead>
                <tbody>{requests.map((request) => { const type = requestMeta[request.requestType]; const state = requestStatusMeta[request.status]; return (
                  <tr key={request.id}>
                    <td><span className={`status-badge ${type.className}`}>{type.label}</span></td>
                    <td><code>{request.itemId ?? request.resultItemId ?? "待分配编号"}</code></td>
                    <td><div className="request-summary"><strong>{request.proposedName ?? items.find((item) => item.id === request.itemId)?.name ?? "-"}</strong><span>{request.proposedSpecification || "无规格变更"} · {request.proposedQuantity || "无数量变更"}</span>{request.reason && <small>{request.reason}</small>}</div></td>
                    <td>{new Date(request.createdAt).toLocaleString("zh-CN")}</td>
                    <td><span className={`status-badge ${state.className}`}>{state.label}</span></td>
                    {isSuperAdmin && <td className="review-actions">{request.status === "pending" ? <><button className="icon-button approve" onClick={() => void reviewRequest(request.id, true)} disabled={submitting} aria-label="批准" title="批准"><Check size={17} /></button><button className="icon-button reject" onClick={() => void reviewRequest(request.id, false)} disabled={submitting} aria-label="拒绝" title="拒绝"><Ban size={17} /></button></> : <span>-</span>}</td>}
                  </tr>
                ); })}</tbody>
              </table>{!loading && requests.length === 0 && <div className="empty-state"><ClipboardList size={26} /><strong>暂无变更请求</strong><span>库存正式数据与请求数据保持隔离</span></div>}</div>
            </section>
          </>
        ) : view === "users" ? (
          <>
            <div className="content-heading"><div><p className="eyebrow">账户与权限</p><h1>人员管理</h1><p>{isSuperAdmin ? "超级管理员可调整角色、部门与启用状态。" : `仅显示${departmentName(profile?.departmentId ?? null)}的普通用户，可维护人员资料。`}</p></div><button className="secondary-button" onClick={() => void loadData()}><RefreshCw size={17} />刷新</button></div>
            <section className="inventory-panel user-panel">
              <div className="table-wrap"><table><thead><tr><th>人员</th><th>角色</th><th>部门 / 职位</th><th>联系方式</th><th>状态</th><th>操作</th></tr></thead>
              <tbody>{visibleManagedUsers.map((user) => (
                <tr key={user.id}>
                  <td><div className="user-cell"><strong>{user.name}</strong><small>{user.studentId || `用户 #${user.id}`} · {user.email || "未绑定邮箱"}</small></div></td>
                  <td><span className={`status-badge ${user.role === "super_admin" ? "overview" : user.role === "admin" ? "borrowed" : "confirmed"}`}>{roleMeta[user.role]}</span></td>
                  <td><div className="user-cell"><strong>{departmentName(user.departmentId)}</strong><small>{user.position || "未填写职位"}</small></div></td>
                  <td>{user.phone || "未填写"}</td>
                  <td><span className={`status-badge ${user.isActive ? "confirmed" : "cancelled"}`}>{user.isActive ? "启用" : "已停用"}</span></td>
                  <td className="action-cell"><button className="secondary-button compact-button" onClick={() => setUserEditor(user)}><Edit3 size={15} />编辑</button></td>
                </tr>
              ))}</tbody></table>{!loading && visibleManagedUsers.length === 0 && <div className="empty-state"><UsersRound size={27} /><strong>暂无可管理人员</strong><span>先在 Supabase Auth 创建账号，再关联用户资料</span></div>}</div>
            </section>
          </>
        ) : view === "borrows" ? (
          <>
            <div className="content-heading"><div><p className="eyebrow">借用状态监管</p><h1>{profile?.role === "member" ? "借用状态和归还申请" : "借用订单"}</h1><p>{isSuperAdmin ? "查看并处理全部部门订单与归还申请。" : isAdmin ? `查看${departmentName(profile?.departmentId ?? null)}本部门订单与归还申请。` : "查看自己的借用状态；借出中的物品必须填写归还申请并扫描对应货架二维码，归还照片可选。"}</p></div><div className="heading-actions"><button className="secondary-button" onClick={() => void loadData()}><RefreshCw size={17} />刷新</button>{profile?.role === "member" && <button className="primary-button" onClick={() => { setView("inventory"); setNotice("请在库存列表勾选物品后填写借用单。"); }}><CalendarClock size={17} />选择物品</button>}</div></div>
            <section className="borrow-filters" aria-label="订单状态筛选">{(["all", "pending", "approved", "borrowed", "return_requested", "returned", "cancelled"] as const).map((status) => <button key={status} className={borrowStatusFilter === status ? "active" : ""} onClick={() => setBorrowStatusFilter(status)}>{status === "all" ? "全部" : borrowStatusMeta[status].label}</button>)}</section>
            <section className="inventory-panel borrow-panel"><div className="table-wrap"><table><thead><tr><th>订单</th><th>借用人 / 部门</th><th>活动</th><th>物品明细</th><th>借用提交 / 预计归还</th><th>状态</th><th>处理</th></tr></thead><tbody>{visibleBorrowOrders.map((order) => { const status = borrowStatusMeta[order.status]; const returnRequest = borrowReturnRequestByOrder.get(order.id); const isMemberOrder = profile?.role === "member"; return <tr key={order.id}><td><div className="user-cell"><strong>{order.orderNumber}</strong><small>借用提交：{formatDateTime(order.createdAt)}</small>{order.returnSubmittedAt && <small>归还提交：{formatDateTime(order.returnSubmittedAt)}</small>}</div></td><td><div className="user-cell"><strong>{userName(order.userId)}</strong><small>{departmentName(order.departmentId)}</small></div></td><td>{activityName(order.activityId)}</td><td><div className="request-summary"><strong>{orderItemSummary(order.id)}</strong>{order.reason && <small>{order.reason}</small>}</div></td><td><span className={isOverdue(order) ? "overdue" : ""}>{order.expectedReturnDate || "未填写"}</span>{isOverdue(order) && <small className="overdue-label">已逾期</small>}</td><td><span className={`status-badge ${status.className}`}>{status.label}</span>{order.borrowedAt && <small className="borrowed-time">实际借出：{formatDateTime(order.borrowedAt)}</small>}{order.actualReturnDate && <small className="borrowed-time">确认归还：{formatDateTime(order.actualReturnDate)}</small>}</td><td>{isMemberOrder ? (order.status === "borrowed" ? <button className="secondary-button compact-button" onClick={() => openReturnEditor(order.id)} disabled={!returnFeatureReady || submitting}><RotateCcw size={14} />填写归还申请</button> : order.status === "return_requested" ? <span className="muted-text">归还审核中</span> : <span className="muted-text">等待管理员</span>) : order.status === "return_requested" && returnRequest ? <button className="secondary-button compact-button" onClick={() => { setReturnReviewRequestId(returnRequest.id); setReturnReviewNote(""); }} disabled={submitting}><Camera size={14} />核验归还</button> : (isSuperAdmin || isAdmin) ? (nextBorrowStatuses(order.status).length > 0 ? <select className="status-select" value={order.status} onChange={(event) => void updateBorrowStatus(order.id, event.target.value as BorrowOrderStatus)} disabled={submitting}><option value={order.status}>{status.label}</option>{nextBorrowStatuses(order.status).map((value) => <option key={value} value={value}>{borrowStatusMeta[value].label}</option>)}</select> : <span className="muted-text">已完成</span>) : <span className="muted-text">等待管理员</span>}</td></tr>; })}</tbody></table>{!loading && visibleBorrowOrders.length === 0 && <div className="empty-state"><PackageCheck size={27} /><strong>暂无借用订单</strong><span>{profile?.role === "member" ? "提交借用申请后，状态会显示在这里" : "当前筛选下暂无借用订单"}</span></div>}</div></section>
          </>
        ) : view === "announcements" ? (
          <>
            <div className="content-heading"><div><p className="eyebrow">系统通知</p><h1>公告管理</h1><p>发布会显示在对应角色工作台中的系统公告。</p></div><div className="heading-actions"><button className="secondary-button" onClick={() => void loadData()}><RefreshCw size={17} />刷新</button><button className="primary-button" onClick={() => setAnnouncementEditor("create")}><BellRing size={17} />发布公告</button></div></div>
            <section className="inventory-panel"><div className="table-wrap"><table><thead><tr><th>标题</th><th>内容</th><th>目标角色</th><th>有效期</th><th>状态</th><th>操作</th></tr></thead><tbody>{announcements.map((announcement) => <tr key={announcement.id}><td><strong>{announcement.title}</strong></td><td><span className="request-summary">{announcement.content}</span></td><td>{announcement.target_role ? roleMeta[announcement.target_role] : "全部角色"}</td><td>{formatDateTime(announcement.starts_at)}<br />至 {announcement.ends_at ? formatDateTime(announcement.ends_at) : "长期"}</td><td><span className={`status-badge ${announcement.is_active ? "confirmed" : "cancelled"}`}>{announcement.is_active ? "已启用" : "已停用"}</span></td><td className="action-cell"><button className="secondary-button compact-button" onClick={() => setAnnouncementEditor(announcement)}><Edit3 size={15} />编辑</button><button className="danger-button compact-button" onClick={() => setDeleteAnnouncementId(announcement.id)}><Trash2 size={15} />删除</button></td></tr>)}</tbody></table>{!loading && announcements.length === 0 && <div className="empty-state"><BellRing size={27} /><strong>暂无公告</strong><span>发布第一条系统公告</span></div>}</div></section>
          </>
        ) : view === "activities" ? (
          <>
            <div className="content-heading"><div><p className="eyebrow">活动与用途</p><h1>活动管理</h1><p>{isSuperAdmin ? "维护全校活动，借用订单可关联活动。" : `维护${departmentName(profile?.departmentId ?? null)}的活动。`}</p></div><div className="heading-actions"><button className="secondary-button" onClick={() => void loadData()}><RefreshCw size={17} />刷新</button><button className="primary-button" onClick={() => setActivityEditor({ mode: "create" })}><Plus size={17} />新增活动</button></div></div>
            <section className="activity-grid" aria-label="活动列表">
              {activities.map((activity) => { const state = activityStatusMeta[activity.status]; const manageable = canManageActivity(activity); return <article className="activity-card" key={activity.id}><div className="activity-card-header"><div className="activity-icon"><CalendarRange size={19} /></div><div><h2>{activity.name}</h2><span>{activity.departmentId ? departmentName(activity.departmentId) : "全局活动"}</span></div><span className={`status-badge ${state.className}`}>{state.label}</span></div><p>{activity.description || "暂无活动说明"}</p><div className="activity-dates"><span>{activity.startDate || "未定开始"}</span><ChevronRight size={14} /><span>{activity.endDate || "未定结束"}</span></div>{manageable && <div className="department-actions"><button className="secondary-button compact-button" onClick={() => setActivityEditor({ mode: "edit", activity })}><Edit3 size={15} />编辑</button><button className="danger-button compact-button" onClick={() => setDeleteActivityId(activity.id)}><Trash2 size={15} />删除</button></div>}</article>; })}
              {!loading && activities.length === 0 && <div className="empty-state"><CalendarRange size={27} /><strong>暂无活动</strong><span>创建活动后，用户借用时即可选择用途</span></div>}
            </section>
          </>
        ) : (
          <>
            <div className="content-heading">
              <div><p className="eyebrow">组织架构</p><h1>部门管理</h1><p>维护当前可用部门，删除部门不会删除用户或借用订单。</p></div>
              <div className="heading-actions"><button className="secondary-button" onClick={() => void loadData()}><RefreshCw size={17} />刷新</button><button className="primary-button" onClick={() => setDepartmentEditor({ mode: "create" })}><Building2 size={17} />新增部门</button></div>
            </div>
            <section className="department-grid" aria-label="部门列表">
              {departments.map((department) => {
                const usage = departmentUsage(department.id);
                return (
                  <article className="department-card" key={department.id}>
                    <div className="department-card-header"><div className="department-icon"><Building2 size={19} /></div><div><h2>{department.name}</h2><span>部门编号 #{department.id}</span></div></div>
                    <p>{department.description || "暂无部门说明"}</p>
                    <dl className="department-stats"><div><dt>关联用户</dt><dd>{usage.users}</dd></div><div><dt>借用订单</dt><dd>{usage.orders}</dd></div></dl>
                    <div className="department-actions"><button className="secondary-button" onClick={() => setDepartmentEditor({ mode: "edit", department })}><Edit3 size={16} />编辑</button><button className="danger-button" onClick={() => setDeleteDepartmentId(department.id)}><Trash2 size={16} />删除</button></div>
                  </article>
                );
              })}
              {!loading && departments.length === 0 && <div className="empty-state"><Building2 size={27} /><strong>暂无部门</strong><span>使用右上角按钮添加部门</span></div>}
            </section>
          </>
        )}
      </main>

      {editor && (
        <div className="modal-layer" role="presentation" onMouseDown={(event) => event.currentTarget === event.target && setEditor(null)}>
          <section className="modal" role="dialog" aria-modal="true" aria-labelledby="editor-title">
            <header><div><p className="eyebrow">{isSuperAdmin ? "正式库存" : "变更申请"}</p><h2 id="editor-title">{editor.mode === "create" ? (isSuperAdmin ? "新增物品" : "申请新增物品") : (isSuperAdmin ? "编辑物品" : "申请修改物品")}</h2></div><button className="icon-button" onClick={() => setEditor(null)} aria-label="关闭"><X size={20} /></button></header>
            <form onSubmit={handleSubmit}>
              {editor.mode === "edit" && <label><span>唯一编号</span><input value={editor.item?.id} disabled /><small>编号由数据库永久分配，不能修改或复用</small></label>}
              {editor.mode === "create" && <div className="info-notice"><CircleAlert size={16} /><span>物品编号将由系统自动生成（如 ITEM0093），无需手动填写</span></div>}
              <label><span>物品名称</span><input name="name" defaultValue={editor.item?.name ?? ""} autoFocus required maxLength={80} /></label>
              <label><span>规格</span><input name="specification" defaultValue={editor.item?.specification ?? ""} maxLength={100} placeholder="尺寸、型号或包装规格" /></label>
              <label><span>数量</span><input name="quantity" defaultValue={editor.item?.quantity ?? "若干"} maxLength={30} /></label>
              <label><span>存放位置</span><LocationSelect defaultValue={editor.item?.locationCode ?? defaultCreateLocation(selection)} /></label>
              <label><span>物品图片</span><input ref={imageInputRef} type="file" name="imageFile" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" capture="environment" onChange={handleImageSelection} /><small>支持拍照或从相册选择，格式为 JPEG、PNG、WebP、HEIC 或 HEIF，最大 10 MB</small></label>
              {(imagePreviewUrl || (editor.mode === "edit" && editor.item?.imagePath)) && <div className="image-upload-preview"><img src={imagePreviewUrl ?? (editor.item?.imagePath ? assetUrl(editor.item.imagePath) : undefined)} alt="待上传的物品预览" /><div><strong>{selectedImage ? "新图片已选择" : "当前图片"}</strong>{selectedImage && <small>{selectedImage.name} · {(selectedImage.size / 1024 / 1024).toFixed(1)} MB</small>}{selectedImage && <button type="button" className="secondary-button compact-button" onClick={clearSelectedImage}><X size={14} />移除</button>}</div></div>}
              {editor.mode === "edit" && <><label><span>图片文件名</span><input name="imageName" defaultValue={editor.item?.imageName ?? ""} maxLength={180} /></label><label><span>图片路径</span><input name="imagePath" defaultValue={editor.item?.imagePath ?? ""} maxLength={300} /></label></>}
              <label><span>识别状态</span><input name="recognitionStatus" defaultValue={editor.item?.recognitionStatus ?? "已确认"} maxLength={80} /></label>
              {!isSuperAdmin && <label><span>申请说明</span><textarea name="reason" rows={3} maxLength={300} placeholder="说明新增或修改原因" required /></label>}
              <div className="form-actions"><button type="button" className="secondary-button" onClick={() => setEditor(null)}>取消</button><button type="submit" className="primary-button" disabled={submitting}>{submitting ? "提交中..." : isSuperAdmin ? "写入正式库存" : <><Send size={16} />提交审批</>}</button></div>
            </form>
          </section>
        </div>
      )}

      {departmentEditor && (
        <div className="modal-layer" role="presentation" onMouseDown={(event) => event.currentTarget === event.target && setDepartmentEditor(null)}>
          <section className="modal" role="dialog" aria-modal="true" aria-labelledby="department-editor-title">
            <header><div><p className="eyebrow">组织架构</p><h2 id="department-editor-title">{departmentEditor.mode === "create" ? "新增部门" : "编辑部门"}</h2></div><button className="icon-button" onClick={() => setDepartmentEditor(null)} aria-label="关闭"><X size={20} /></button></header>
            <form onSubmit={handleDepartmentSubmit}>
              <label><span>部门名称</span><input name="name" defaultValue={departmentEditor.department?.name ?? ""} autoFocus required maxLength={80} placeholder="例如：宣传部" /></label>
              <label><span>部门说明</span><textarea name="description" defaultValue={departmentEditor.department?.description ?? ""} rows={4} maxLength={300} placeholder="描述部门职责或备注（可选）" /></label>
              <div className="form-actions"><button type="button" className="secondary-button" onClick={() => setDepartmentEditor(null)}>取消</button><button type="submit" className="primary-button" disabled={submitting}>{submitting ? "保存中..." : "保存部门"}</button></div>
            </form>
          </section>
        </div>
      )}

      {activityEditor && (
        <div className="modal-layer" role="presentation" onMouseDown={(event) => event.currentTarget === event.target && setActivityEditor(null)}>
          <section className="modal" role="dialog" aria-modal="true" aria-labelledby="activity-editor-title">
            <header><div><p className="eyebrow">活动管理</p><h2 id="activity-editor-title">{activityEditor.mode === "create" ? "新增活动" : "编辑活动"}</h2></div><button className="icon-button" onClick={() => setActivityEditor(null)} aria-label="关闭"><X size={20} /></button></header>
            <form onSubmit={handleActivitySubmit}>
              <label><span>活动名称</span><input name="name" defaultValue={activityEditor.activity?.name ?? ""} autoFocus required maxLength={100} /></label>
              <label><span>活动说明</span><textarea name="description" defaultValue={activityEditor.activity?.description ?? ""} rows={3} maxLength={500} /></label>
              <div className="form-grid">
                <label><span>开始日期</span><input name="startDate" type="date" defaultValue={activityEditor.activity?.startDate ?? ""} /></label>
                <label><span>结束日期</span><input name="endDate" type="date" defaultValue={activityEditor.activity?.endDate ?? ""} /></label>
              </div>
              {isSuperAdmin && <label><span>所属部门</span><select name="departmentId" defaultValue={activityEditor.activity?.departmentId ?? ""}><option value="">全局活动</option>{departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}</select></label>}
              <label><span>状态</span><select name="status" defaultValue={activityEditor.activity?.status ?? "active"}>{Object.entries(activityStatusMeta).map(([value, meta]) => <option key={value} value={value}>{meta.label}</option>)}</select></label>
              <div className="form-actions"><button type="button" className="secondary-button" onClick={() => setActivityEditor(null)}>取消</button><button type="submit" className="primary-button" disabled={submitting}>{submitting ? "保存中..." : "保存活动"}</button></div>
            </form>
          </section>
        </div>
      )}

      {announcementEditor && (
        <div className="modal-layer" role="presentation" onMouseDown={(event) => event.currentTarget === event.target && setAnnouncementEditor(null)}>
          <section className="modal" role="dialog" aria-modal="true" aria-labelledby="announcement-editor-title">
            <header><div><p className="eyebrow">系统通知</p><h2 id="announcement-editor-title">{announcementEditor === "create" ? "发布公告" : "编辑公告"}</h2></div><button className="icon-button" onClick={() => setAnnouncementEditor(null)} aria-label="关闭"><X size={20} /></button></header>
            <form onSubmit={handleAnnouncementSubmit}>
              <label><span>标题</span><input name="title" defaultValue={announcementEditor === "create" ? "" : announcementEditor.title} autoFocus required maxLength={120} /></label>
              <label><span>内容</span><textarea name="content" defaultValue={announcementEditor === "create" ? "" : announcementEditor.content} rows={5} required maxLength={2000} /></label>
              <label><span>目标角色</span><select name="targetRole" defaultValue={announcementEditor === "create" ? "" : announcementEditor.target_role ?? ""}><option value="">全部角色</option><option value="super_admin">系统管理员</option><option value="admin">部门管理员</option><option value="member">普通用户</option></select></label>
              <div className="form-grid"><label><span>开始时间</span><input name="startsAt" type="datetime-local" defaultValue={announcementEditor === "create" ? "" : announcementEditor.starts_at.slice(0, 16)} /></label><label><span>结束时间</span><input name="endsAt" type="datetime-local" defaultValue={announcementEditor === "create" ? "" : announcementEditor.ends_at?.slice(0, 16) ?? ""} /></label></div>
              <label className="checkbox-label"><input type="checkbox" name="isActive" defaultChecked={announcementEditor === "create" ? true : announcementEditor.is_active} /><span>立即启用</span></label>
              <div className="form-actions"><button type="button" className="secondary-button" onClick={() => setAnnouncementEditor(null)}>取消</button><button type="submit" className="primary-button" disabled={submitting}>{submitting ? "保存中..." : "保存公告"}</button></div>
            </form>
          </section>
        </div>
      )}

      {userEditor && (
        <div className="modal-layer" role="presentation" onMouseDown={(event) => event.currentTarget === event.target && setUserEditor(null)}>
          <section className="modal" role="dialog" aria-modal="true" aria-labelledby="user-editor-title">
            <header><div><p className="eyebrow">账户与权限</p><h2 id="user-editor-title">编辑人员</h2></div><button className="icon-button" onClick={() => setUserEditor(null)} aria-label="关闭"><X size={20} /></button></header>
            <form onSubmit={handleUserSubmit}>
              <label><span>姓名</span><input name="name" defaultValue={userEditor.name} autoFocus required maxLength={80} /></label>
              <label><span>学号 / 工号</span><input name="studentId" defaultValue={userEditor.studentId ?? ""} disabled={!isSuperAdmin} maxLength={80} /></label>
              <label><span>邮箱</span><input name="email" type="email" defaultValue={userEditor.email ?? ""} disabled={!isSuperAdmin} maxLength={160} /></label>
              <label><span>电话</span><input name="phone" defaultValue={userEditor.phone ?? ""} maxLength={40} /></label>
              <label><span>职位</span><input name="position" defaultValue={userEditor.position ?? ""} placeholder="部长、副部长、干事" maxLength={40} /></label>
              {isSuperAdmin && <label><span>角色</span><select name="role" defaultValue={userEditor.role}>{Object.entries(roleMeta).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>}
              {isSuperAdmin && <label><span>部门</span><select name="departmentId" defaultValue={userEditor.departmentId ?? ""}><option value="">未分配</option>{departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}</select></label>}
              <label><span>备注</span><textarea name="notes" defaultValue={userEditor.notes ?? ""} rows={3} maxLength={300} /></label>
              <label className="checkbox-label"><input type="checkbox" name="isActive" defaultChecked={userEditor.isActive} /><span>账号启用</span></label>
              {!isSuperAdmin && <small className="form-hint">普通管理员只能维护本部门普通用户的资料，不能修改角色、部门或 Auth 绑定。</small>}
              <div className="form-actions"><button type="button" className="secondary-button" onClick={() => setUserEditor(null)}>取消</button><button type="submit" className="primary-button" disabled={submitting}>{submitting ? "保存中..." : "保存人员"}</button></div>
            </form>
          </section>
        </div>
      )}

      {borrowEditorOpen && (
        <div className="modal-layer" role="presentation" onMouseDown={(event) => event.currentTarget === event.target && setBorrowEditorOpen(false)}>
          <section className="modal borrow-modal" role="dialog" aria-modal="true" aria-labelledby="borrow-editor-title">
            <header><div><p className="eyebrow">库存借用</p><h2 id="borrow-editor-title">填写借用单</h2></div><button className="icon-button" onClick={() => setBorrowEditorOpen(false)} aria-label="关闭"><X size={20} /></button></header>
            <form onSubmit={handleBorrowSubmit}>
              <div className="borrow-selection-heading"><div><strong>本次借用物品</strong><span>共 {selectedItems.length} 件</span></div><button type="button" className="secondary-button compact-button" onClick={() => { setBorrowEditorOpen(false); setView("inventory"); }}><ListChecks size={14} />继续选择</button></div>
              <div className="borrow-selection-list">{selectedItems.map((item) => <div key={item.id} className="borrow-selection-row"><div><strong>{item.name}</strong><small>{item.id} · {locationLabel(item.locationCode)}</small></div><label><span>数量</span><input name={`quantity_${item.id}`} type="number" min={1} defaultValue={1} required /></label><button type="button" className="icon-button" onClick={() => toggleItemSelection(item.id)} aria-label={`移除 ${item.name}`} title="移除"><X size={16} /></button></div>)}</div>
              <label><span>所属活动</span><select name="activityId" defaultValue=""><option value="">不关联活动</option>{activeActivities.map((activity) => <option key={activity.id} value={activity.id}>{activity.name}{activity.departmentId ? ` · ${departmentName(activity.departmentId)}` : ""}</option>)}</select></label>
              <label><span>预计归还日期</span><input name="expectedReturnDate" type="date" min={new Date().toISOString().slice(0, 10)} required /></label>
              <label><span>借用理由</span><textarea name="reason" rows={3} required maxLength={300} placeholder="填写活动或工作用途" /></label>
              <label><span>备注</span><textarea name="notes" rows={2} maxLength={300} placeholder="可选" /></label>
              <div className="form-actions"><button type="button" className="secondary-button" onClick={() => setBorrowEditorOpen(false)}>取消</button><button type="submit" className="primary-button" disabled={submitting}>{submitting ? "提交中..." : "提交借用申请"}</button></div>
            </form>
          </section>
        </div>
      )}

      {returnEditorOrder && (
        <div className="modal-layer" role="presentation" onMouseDown={(event) => event.currentTarget === event.target && setReturnEditorOrderId(null)}>
          <section className="modal borrow-modal return-modal" role="dialog" aria-modal="true" aria-labelledby="return-editor-title">
            <header><div><p className="eyebrow">物品归还</p><h2 id="return-editor-title">填写归还申请</h2><small className="modal-subtitle">订单 {returnEditorOrder.orderNumber} · 系统会记录本次提交的准确时间</small></div><button className="icon-button" onClick={() => setReturnEditorOrderId(null)} aria-label="关闭"><X size={20} /></button></header>
            <form onSubmit={handleReturnSubmit}>
              <div className="info-notice"><RotateCcw size={16} /><span>请将每件物品放回借出前的原位，并扫描该货架专属二维码。系统会校验二维码位置与借出快照一致；归还照片可选，管理员核验通过后才会变为“已归还”。</span></div>
              <div className="return-selection-list">{returnItemsForOrder.map((line) => { const item = items.find((candidate) => candidate.id === line.item_id); const originalLocation = originalLocationForLine(line); return <article className="return-item-card" key={line.id}><div className="return-item-heading"><div><strong>{item?.name ?? line.item_id}</strong><small>{line.item_id} · 数量 {line.quantity_borrowed - line.quantity_returned}</small></div><span className="location-pill"><MapPin size={14} />原位：{locationLabel(originalLocation)}</span></div><div className="return-scan-row">{scannedLocations[line.id] ? <span className="scan-success"><Check size={15} />已验证 {locationLabel(scannedLocations[line.id])}</span> : <span className="scan-pending">尚未验证货架二维码</span>}<button type="button" className="secondary-button compact-button" onClick={() => { setScanLineId(line.id); setScanPayload(""); setScanError(null); }}><Camera size={15} />扫描货架二维码</button></div><label><span>归还照片（可选）</span><input type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" capture="environment" onChange={(event) => handleReturnPhotoSelection(line.id, event)} /><small>可拍摄物品放回原位后的现场照片，最大 10 MB</small></label><label><span>物品状态</span><select name={`condition_${line.id}`} defaultValue="good"><option value="good">完好</option><option value="damaged">有损坏</option><option value="lost">遗失</option></select></label><label><span>归还备注</span><textarea name={`returnNote_${line.id}`} rows={2} maxLength={200} placeholder="可选，例如损坏位置、缺少配件" /></label></article>; })}</div>
              <label><span>归还说明</span><textarea name="returnNotes" rows={3} maxLength={300} placeholder="填写本次归还的补充说明" /></label>
              <div className="form-actions"><button type="button" className="secondary-button" onClick={() => setReturnEditorOrderId(null)}>取消</button><button type="submit" className="primary-button" disabled={submitting}><Send size={16} />{submitting ? "提交中..." : "提交归还申请"}</button></div>
            </form>
          </section>
        </div>
      )}

      {returnReviewRequest && (
        <div className="modal-layer" role="presentation" onMouseDown={(event) => event.currentTarget === event.target && setReturnReviewRequestId(null)}>
          <section className="modal return-modal" role="dialog" aria-modal="true" aria-labelledby="return-review-title">
            <header><div><p className="eyebrow">归还审核</p><h2 id="return-review-title">核验归还物品</h2><small className="modal-subtitle">提交时间：{formatDateTime(returnReviewRequest.submitted_at)}</small></div><button className="icon-button" onClick={() => setReturnReviewRequestId(null)} aria-label="关闭"><X size={20} /></button></header>
            <div className="return-review-list">{returnReviewItems.map((entry) => { const item = items.find((candidate) => candidate.id === entry.item_id); return <article className="return-review-card" key={entry.id}><div><strong>{item?.name ?? entry.item_id}</strong><small>{entry.item_id} · 原位：{locationLabel(entry.original_location_code)} · 归还：{locationLabel(entry.returned_location_code)}</small></div>{entry.photo_path && returnPhotoUrls[entry.photo_path] ? <img src={returnPhotoUrls[entry.photo_path]} alt={`${item?.name ?? entry.item_id}归还照片`} /> : <span className="photo-missing">未上传照片</span>}<span className={`status-badge ${entry.item_condition === "good" ? "confirmed" : entry.item_condition === "damaged" ? "pending" : "cancelled"}`}>{entry.item_condition === "good" ? "完好" : entry.item_condition === "damaged" ? "有损坏" : "遗失"}</span>{entry.notes && <small>{entry.notes}</small>}</article>; })}</div>
            <label className="review-note-field"><span>审核备注</span><textarea value={returnReviewNote} onChange={(event) => setReturnReviewNote(event.target.value)} rows={3} maxLength={300} placeholder="填写通过或驳回原因" /></label>
            <div className="form-actions"><button type="button" className="secondary-button" onClick={() => setReturnReviewRequestId(null)}>取消</button><button type="button" className="danger-button" onClick={() => void reviewReturnRequest(returnReviewRequest.id, false)} disabled={submitting}><Ban size={16} />驳回</button><button type="button" className="primary-button" onClick={() => void reviewReturnRequest(returnReviewRequest.id, true)} disabled={submitting}><Check size={16} />确认归还</button></div>
          </section>
        </div>
      )}

      {scanLineId !== null && (
        <div className="modal-layer" role="presentation" onMouseDown={(event) => event.currentTarget === event.target && setScanLineId(null)}>
          <section className="modal qr-scan-modal" role="dialog" aria-modal="true" aria-labelledby="qr-scan-title">
            <header><div><p className="eyebrow">货架验证</p><h2 id="qr-scan-title">扫描专属二维码</h2><small className="modal-subtitle">目标位置：{locationLabel(originalLocationForLine(returnItemsForOrder.find((line) => line.id === scanLineId)!))}</small></div><button className="icon-button" onClick={() => setScanLineId(null)} aria-label="关闭"><X size={20} /></button></header>
            <video ref={scanVideoRef} className="qr-scan-video" muted playsInline aria-label="二维码摄像头预览" />
            {scanError && <div className="page-error" role="alert"><CircleAlert size={16} />{scanError}</div>}
            <label><span>二维码内容（摄像头不可用时可粘贴）</span><input value={scanPayload} onChange={(event) => setScanPayload(event.target.value)} placeholder="513-warehouse:A1" /></label>
            <div className="form-actions"><button type="button" className="secondary-button" onClick={() => setScanLineId(null)}>取消</button><button type="button" className="primary-button" onClick={() => { const line = returnItemsForOrder.find((candidate) => candidate.id === scanLineId); if (line) confirmShelfScan(line, scanPayload); }} disabled={!scanPayload.trim()}><Check size={16} />验证二维码</button></div>
          </section>
        </div>
      )}

      {selectedDetail && (
        <div className="drawer-layer" onMouseDown={(event) => event.currentTarget === event.target && setDetailId(null)}>
          <aside className="detail-drawer" aria-label="物品详情">
            <header><div><p className="eyebrow">正式库存</p><h2>{selectedDetail.name}</h2></div><button className="icon-button" onClick={() => setDetailId(null)} aria-label="关闭"><X size={20} /></button></header>
            {selectedDetail.imagePath ? <img className="detail-image" src={assetUrl(selectedDetail.imagePath)} alt={selectedDetail.name} /> : <div className="detail-image placeholder"><Box size={38} /></div>}
            <dl className="detail-list"><div><dt>唯一编号</dt><dd><code>{selectedDetail.id}</code></dd></div><div><dt>存放位置</dt><dd>{locationLabel(selectedDetail.locationCode)}</dd></div><div><dt>规格</dt><dd>{selectedDetail.specification || "未填写"}</dd></div><div><dt>数量</dt><dd>{selectedDetail.quantity}</dd></div><div><dt>图片文件名</dt><dd>{selectedDetail.imageName || "未填写"}</dd></div><div><dt>识别状态</dt><dd>{selectedDetail.recognitionStatus}</dd></div></dl>
            {borrowSummary(selectedDetail.id) && <section className="borrow-detail"><h3><PackageCheck size={17} />当前借出信息</h3><dl><div><dt>借用人</dt><dd>{borrowSummary(selectedDetail.id)?.borrower_name}</dd></div><div><dt>所属部门</dt><dd>{borrowSummary(selectedDetail.id)?.department_name || "未分配"}</dd></div><div><dt>借出时间</dt><dd>{new Date(borrowSummary(selectedDetail.id)!.borrowed_at).toLocaleString("zh-CN")}</dd></div><div><dt>预计归还</dt><dd>{borrowSummary(selectedDetail.id)?.expected_return_date || "未填写"}</dd></div><div><dt>所属活动</dt><dd>{borrowSummary(selectedDetail.id)?.activity_name || "未关联活动"}</dd></div><div><dt>借用单号</dt><dd>{borrowSummary(selectedDetail.id)?.order_number}</dd></div></dl></section>}
            {profile?.role !== "member" && <div className="drawer-actions"><button className="primary-button" onClick={() => { setEditor({ mode: "edit", item: selectedDetail }); setDetailId(null); }}><Edit3 size={17} />{isSuperAdmin ? "编辑" : "申请修改"}</button><button className="danger-button" onClick={() => setDeleteId(selectedDetail.id)}><Trash2 size={17} />{isSuperAdmin ? "删除物品" : "申请删除"}</button></div>}
            <section className="history-section"><h3><Clock3 size={17} />位置记录</h3>{history.filter((entry) => entry.itemId === selectedDetail.id).length === 0 ? <p>暂无位置变更记录</p> : <ol>{history.filter((entry) => entry.itemId === selectedDetail.id).map((entry) => <li key={entry.id}><span>{locationLabel(entry.fromLocation ?? "")}</span><ChevronRight size={15} /><strong>{locationLabel(entry.toLocation)}</strong><time>{new Date(entry.movedAt).toLocaleString("zh-CN")}</time></li>)}</ol>}</section>
          </aside>
        </div>
      )}

      {deleteId && (
        <div className="modal-layer" role="presentation"><section className="confirm-modal" role="alertdialog" aria-modal="true"><div className="danger-icon"><Trash2 size={22} /></div><h2>{isSuperAdmin ? "删除这个物品？" : "提交删除申请？"}</h2><p>{items.find((item) => item.id === deleteId)?.name}（{deleteId}）{isSuperAdmin ? "将从正式库存中移除，编号不会再次分配。" : "会保留在正式库存中，直到超级管理员批准。"}</p><div className="form-actions"><button className="secondary-button" onClick={() => setDeleteId(null)}>取消</button><button className="danger-button solid" onClick={() => void confirmDelete()} disabled={submitting}>{isSuperAdmin ? "确认删除" : "提交申请"}</button></div></section></div>
      )}

      {deleteDepartmentId !== null && (
        <div className="modal-layer" role="presentation"><section className="confirm-modal" role="alertdialog" aria-modal="true"><div className="danger-icon"><Trash2 size={22} /></div><h2>删除这个部门？</h2><p>“{departments.find((department) => department.id === deleteDepartmentId)?.name}”删除后，关联用户和借用订单会保留，但部门字段会变为未分配。</p><div className="form-actions"><button className="secondary-button" onClick={() => setDeleteDepartmentId(null)}>取消</button><button className="danger-button solid" onClick={() => void confirmDepartmentDelete()} disabled={submitting}>{submitting ? "删除中..." : "确认删除"}</button></div></section></div>
      )}

      {deleteActivityId !== null && (
        <div className="modal-layer" role="presentation"><section className="confirm-modal" role="alertdialog" aria-modal="true"><div className="danger-icon"><Trash2 size={22} /></div><h2>删除这个活动？</h2><p>“{activities.find((activity) => activity.id === deleteActivityId)?.name}”删除后，历史借用订单保留，但不再显示活动关联。</p><div className="form-actions"><button className="secondary-button" onClick={() => setDeleteActivityId(null)}>取消</button><button className="danger-button solid" onClick={() => void confirmActivityDelete()} disabled={submitting}>{submitting ? "删除中..." : "确认删除"}</button></div></section></div>
      )}

      {deleteAnnouncementId !== null && (
        <div className="modal-layer" role="presentation"><section className="confirm-modal" role="alertdialog" aria-modal="true"><div className="danger-icon"><Trash2 size={22} /></div><h2>删除这条公告？</h2><p>“{announcements.find((announcement) => announcement.id === deleteAnnouncementId)?.title}”将被永久删除。</p><div className="form-actions"><button className="secondary-button" onClick={() => setDeleteAnnouncementId(null)}>取消</button><button className="danger-button solid" onClick={() => void confirmAnnouncementDelete()} disabled={submitting}>{submitting ? "删除中..." : "确认删除"}</button></div></section></div>
      )}
    </div>
  );
}

export default App;
