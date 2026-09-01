# UI Verification Checklist (run before recording the Loom)

Prereqs: `npm run dev` running, database seeded (Task 2 of the delivery plan).

1. [ ] Open http://localhost:5173/ — landing page loads, no console errors.
2. [ ] Click through to /login — login form renders.
3. [ ] Log in as dispatcher@test.com / password123 — redirected to /app, load list shown (empty or seeded).
4. [ ] Click "+ New Load", enter an origin/destination, submit — redirected to the load detail page, status chip shows "Created".
5. [ ] In "Assign Driver & Vehicle", select "Charlie Expired" and a vehicle, submit — an error banner appears (expired cert), no crash.
6. [ ] Re-submit with "Alice Eligible" — assignment succeeds, the form disappears, driver/vehicle now show in the detail grid.
7. [ ] In "Change Status", select "Assigned", click Advance — status chip updates to "Assigned", a row appears in the Audit Trail section.
8. [ ] Advance again to "In Transit" — status updates, second audit row appears with correct from/to and actor name.
9. [ ] Use Revert to go back to "Assigned" — status updates, third audit row appears.
10. [ ] Advance forward again to "In Transit" then "Delivered" — confirm each hop logs correctly and the "Change Status" panel shows "No transitions available" once Delivered is reached (per the seeded transition graph).
11. [ ] Log out, log back in as admin@test.com / password123 — same company's loads visible (proves company scoping isn't accidentally per-user).
12. [ ] Open browser dev tools Network tab during step 7 — confirm the POST to /api/loads/:id/advance returns 200 and the response includes both `load` and `log`.

Any failed step: file it as a bug and fix before the recording, don't route around it in the demo script.
