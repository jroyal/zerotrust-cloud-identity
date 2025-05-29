resource "cloudflare_workers_kv_namespace" "zt-cloud-identity-kv" {
  account_id = var.cloudflare_account_id
  title      = "CONFIG"
}

# run npm install && npm run build before deploying

resource "cloudflare_workers_script" "zt-cloud-identity-hackathon" {
  account_id = var.cloudflare_account_id
  script_name = "zt-cloud-identity-hackathon-worker"
  content = file("../../workload/cloudflare/dist/index.js")
  main_module = "index.js"
  compatibility_date = "2025-05-28"

  observability = {
    enabled = true
  }

  bindings = [
    {
      "type": "kv_namespace",
      "name": "CONFIG"
      "namespace_id": cloudflare_workers_kv_namespace.zt-cloud-identity-kv.id
    }
  ]
}