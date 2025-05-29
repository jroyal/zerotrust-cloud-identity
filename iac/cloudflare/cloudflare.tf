terraform {
  required_providers {
    cloudflare = {
      source = "cloudflare/cloudflare"
      version = "~> 5"
    }
  }
}

# TF_VAR_cloudflare_api_token
variable "cloudflare_api_token" {
  type = string
  sensitive = true
}

# TF_VAR_cloudflare_account_id
variable "cloudflare_account_id" {
  type = string
}

provider "cloudflare" {
  api_token = var.cloudflare_api_token
}
