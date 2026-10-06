"use client";

import { useState } from "react";
import CreateCustomerForm from "./create-customer-form";

export default function CreateCustomerSection() {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button className="btn" onClick={() => setOpen(true)}>
        + Create account
      </button>
    );
  }

  return (
    <div className="card" style={{ marginBottom: 24 }}>
      <CreateCustomerForm onDone={() => setOpen(false)} />
    </div>
  );
}
