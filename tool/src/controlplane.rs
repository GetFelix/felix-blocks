//! The control plane's REST API, as far as creating a world needs it.

use anyhow::{Context, Result, bail};
use reqwest::{Client, StatusCode};
use serde_json::Value;

pub(crate) struct ControlPlane {
    http: Client,
    tenant_url: String,
    token: String,
}

impl ControlPlane {
    pub(crate) fn new(base: &str, tenant: &str, token: &str) -> Result<ControlPlane> {
        Ok(ControlPlane {
            http: Client::builder().build().context("build the HTTP client")?,
            tenant_url: format!("{}/v1/tenants/{tenant}", base.trim_end_matches('/')),
            token: token.trim().to_owned(),
        })
    }

    pub(crate) async fn create_cache(&self, namespace: &str, body: &Value) -> Result<()> {
        self.post(&format!("namespaces/{namespace}/caches"), body)
            .await
    }

    pub(crate) async fn create_stream(&self, namespace: &str, body: &Value) -> Result<()> {
        self.post(&format!("namespaces/{namespace}/streams"), body)
            .await
    }

    pub(crate) async fn add_policy(&self, body: &Value) -> Result<()> {
        self.post("rbac/policies", body).await
    }

    pub(crate) async fn add_grouping(&self, body: &Value) -> Result<()> {
        self.post("rbac/groupings", body).await
    }

    async fn post(&self, path: &str, body: &Value) -> Result<()> {
        let url = format!("{}/{path}", self.tenant_url);
        let response = self
            .http
            .post(&url)
            .bearer_auth(&self.token)
            .json(body)
            .send()
            .await
            .with_context(|| format!("reach the control plane at {url}"))?;
        match response.status() {
            // Already there, which makes a second run of `create` harmless. Its settings are not compared.
            StatusCode::CONFLICT => Ok(()),
            status if status.is_success() => Ok(()),
            status => {
                let text = response.text().await.unwrap_or_default();
                bail!("POST {url} was refused with {status}: {text}")
            }
        }
    }
}
