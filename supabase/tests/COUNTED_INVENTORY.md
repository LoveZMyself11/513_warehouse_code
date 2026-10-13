# Counted Inventory

Apply migrations in order, including
`20261013063513_counted_inventory_borrowing.sql`, before deploying the updated frontend.
If the availability RPC is unavailable, the frontend disables new item selection.

An explicit integer inventory quantity (0 to 2147483647) enables counted borrowing.
For example, enter quantity `100` and specification `瓶`. Text quantities such as
`若干` or `100瓶` retain whole-item borrowing with a maximum request quantity of 1.
Existing quantities are not automatically rewritten.

Pending, approved, borrowed, and return-requested orders reserve their outstanding
quantities. Cancellation releases the reservation; approval does not reserve twice.
An approved return restores availability. Each order still returns all of its
outstanding lines; partial returns and consumable issuance are separate workflows.

Applications lock inventory rows in ID order before validating aggregate occupancy.
Inventory edits cannot reduce stock below active occupancy. Older pending counted
orders that already exceed capacity must be resolved before approval.

Run `counted_inventory.sql` as database owner against a disposable database with all
base scripts and migrations applied. It creates temporary users and stock and rolls
back. It covers reservations across users, over-allocation, failed batch rollback,
legacy text quantities, zero stock, cancellation, approval, return review, stock
edits, and unauthenticated access. Run the existing workflow and location tests too.
