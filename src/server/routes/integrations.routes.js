import { runAutomaticSamsaraSync } from "../integrations/samsara/samsara.auto-sync.js";
import { requireCompanyAccess } from "../auth/authorize.js";
import "../integrations/samsara/samsara.adapter.js";
import { getIntegrationProvider } from "../integrations/core/integration-provider.registry.js";
import {
  companyIntegrationClients,
  createCompanyIntegrationClient,
  revokeCompanyIntegrationClient,
} from "../integrations/core/integration-clients.service.js";
import {
  configureOdoo,
  configureOdooOutboundLaborProduct,
  configureOdooOutboundVehicle,
  configureOdooOutboundWarehouse,
  discoverOdooOutbound,
  discoverOdooLocations,
  listOdooLocationMappings,
  odooAdminStatus,
  odooOutboundReadiness,
  odooOutboundProviderVehicles,
  odooOutboundVehicles,
  setOdooLocationMapping,
  syncOdooPartsAndInventory,
  testOdoo,
} from "../integrations/odoo/odoo.admin.service.js";
import {
  odooConfigurationSchema,
  odooLocationMappingSchema,
  odooOutboundLaborProductSchema,
  odooOutboundInternalIdSchema,
  odooOutboundProviderVehicleListSchema,
  odooOutboundVehicleListSchema,
  odooOutboundVehicleMappingSchema,
  odooOutboundWarehouseMappingSchema,
} from "../integrations/odoo/odoo.admin.schemas.js";
import {
  createOdooWorkorderDraft,
  odooWorkorderReadiness,
  prepareOdooWorkorder,
} from "../integrations/odoo/odoo.outbound.service.js";
import {
  createOdooDraftSchema,
  prepareOdooWorkorderSchema,
} from "../integrations/odoo/odoo.outbound.schemas.js";

const samsara = getIntegrationProvider("samsara");

function validated(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) {
    const error = new Error(result.error.issues[0]?.message || "Invalid integration settings.");
    error.statusCode = 400;
    throw error;
  }
  return result.data;
}

function selectedCompanyId(url, requestContext) {
  const companyId = url.searchParams.get("companyId") || [...(requestContext.companyIds || [])][0];
  requireCompanyAccess(requestContext, companyId);
  return companyId;
}

export async function handleIntegrationsApi(req, res, url, helpers) {
  const { sendJson, requestContext } = helpers;

  if (req.method === "GET" && url.pathname === "/api/integrations/samsara/status") {
    const companyId = selectedCompanyId(url, requestContext);
    sendJson(res, 200, await samsara.status(companyId));
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/integrations/samsara/oauth/start") {
    try {
      const companyId = selectedCompanyId(url, requestContext);
      const authUrl = await samsara.oauthStartUrl(req, companyId);
      res.writeHead(302, { location: authUrl });
    } catch (error) {
      res.writeHead(302, { location: `/?samsara=error&message=${encodeURIComponent(error.message)}` });
    }
    res.end();
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/integrations/samsara/oauth/callback") {
    try {
      await samsara.oauthCallback(url);
      runAutomaticSamsaraSync("oauth_callback").catch(() => {});
      res.writeHead(302, { location: "/?samsara=connected" });
      res.end();
    } catch (error) {
      res.writeHead(302, { location: `/?samsara=error&message=${encodeURIComponent(error.message)}` });
      res.end();
    }
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/integrations/samsara/test") {
    const companyId = selectedCompanyId(url, requestContext);
    sendJson(res, 200, await samsara.test(companyId));
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/integrations/samsara/sync") {
    const companyId = selectedCompanyId(url, requestContext);
    sendJson(res, 200, await samsara.sync({ companyId }));
    return true;
  }

  if (req.method === "DELETE" && url.pathname === "/api/integrations/samsara") {
    const companyId = selectedCompanyId(url, requestContext);
    sendJson(res, 200, await samsara.disconnect(companyId));
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/integrations/odoo/status") {
    const companyId = selectedCompanyId(url, requestContext);
    sendJson(res, 200, await odooAdminStatus(companyId));
    return true;
  }

  if (req.method === "PUT" && url.pathname === "/api/integrations/odoo/configuration") {
    const companyId = selectedCompanyId(url, requestContext);
    const input = validated(odooConfigurationSchema, await helpers.readBody(req));
    sendJson(res, 200, await configureOdoo(companyId, input));
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/integrations/odoo/test") {
    const companyId = selectedCompanyId(url, requestContext);
    sendJson(res, 200, await testOdoo(companyId));
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/integrations/odoo/discover-locations") {
    const companyId = selectedCompanyId(url, requestContext);
    sendJson(res, 200, await discoverOdooLocations(companyId));
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/integrations/odoo/locations") {
    const companyId = selectedCompanyId(url, requestContext);
    sendJson(res, 200, await listOdooLocationMappings(companyId));
    return true;
  }

  const odooLocationMatch = /^\/api\/integrations\/odoo\/locations\/([^/]+)\/mapping$/.exec(url.pathname);
  if (req.method === "PUT" && odooLocationMatch) {
    const companyId = selectedCompanyId(url, requestContext);
    const input = validated(odooLocationMappingSchema, await helpers.readBody(req));
    sendJson(res, 200, await setOdooLocationMapping(
      companyId,
      decodeURIComponent(odooLocationMatch[1]),
      input,
    ));
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/integrations/odoo/sync") {
    const companyId = selectedCompanyId(url, requestContext);
    sendJson(res, 200, await syncOdooPartsAndInventory(companyId));
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/integrations/odoo/outbound/discover") {
    const companyId = selectedCompanyId(url, requestContext);
    sendJson(res, 200, await discoverOdooOutbound(companyId));
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/integrations/odoo/outbound/readiness") {
    const companyId = selectedCompanyId(url, requestContext);
    sendJson(res, 200, await odooOutboundReadiness(companyId));
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/integrations/odoo/outbound/vehicles") {
    const companyId = selectedCompanyId(url, requestContext);
    const input = validated(odooOutboundVehicleListSchema, Object.fromEntries(url.searchParams));
    sendJson(res, 200, await odooOutboundVehicles(companyId, input));
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/integrations/odoo/outbound/odoo-vehicles") {
    const companyId = selectedCompanyId(url, requestContext);
    const input = validated(odooOutboundProviderVehicleListSchema, Object.fromEntries(url.searchParams));
    sendJson(res, 200, await odooOutboundProviderVehicles(companyId, input));
    return true;
  }

  const outboundAssetMatch = /^\/api\/integrations\/odoo\/outbound\/assets\/([^/]+)\/mapping$/.exec(url.pathname);
  if (req.method === "PUT" && outboundAssetMatch) {
    const companyId = selectedCompanyId(url, requestContext);
    const input = validated(odooOutboundVehicleMappingSchema, await helpers.readBody(req));
    sendJson(res, 200, await configureOdooOutboundVehicle(
      companyId,
      validated(odooOutboundInternalIdSchema, decodeURIComponent(outboundAssetMatch[1])),
      input,
      { userId: requestContext.actor.id, requestId: req.requestId },
    ));
    return true;
  }

  const outboundLocationMatch = /^\/api\/integrations\/odoo\/outbound\/locations\/([^/]+)\/warehouse$/.exec(url.pathname);
  if (req.method === "PUT" && outboundLocationMatch) {
    const companyId = selectedCompanyId(url, requestContext);
    const input = validated(odooOutboundWarehouseMappingSchema, await helpers.readBody(req));
    sendJson(res, 200, await configureOdooOutboundWarehouse(
      companyId,
      validated(odooOutboundInternalIdSchema, decodeURIComponent(outboundLocationMatch[1])),
      input,
      { userId: requestContext.actor.id, requestId: req.requestId },
    ));
    return true;
  }

  if (req.method === "PUT" && url.pathname === "/api/integrations/odoo/outbound/labor-product") {
    const companyId = selectedCompanyId(url, requestContext);
    const input = validated(odooOutboundLaborProductSchema, await helpers.readBody(req));
    sendJson(res, 200, await configureOdooOutboundLaborProduct(
      companyId,
      input,
      { userId: requestContext.actor.id, requestId: req.requestId },
    ));
    return true;
  }

  const outboundWorkorderMatch = /^\/api\/integrations\/odoo\/outbound\/workorders\/([^/]+)\/(preparation|readiness|draft)$/.exec(url.pathname);
  if (outboundWorkorderMatch) {
    const companyId = selectedCompanyId(url, requestContext);
    const workorderId = decodeURIComponent(outboundWorkorderMatch[1]);
    const action = outboundWorkorderMatch[2];
    if (req.method === "PUT" && action === "preparation") {
      const input = validated(prepareOdooWorkorderSchema, await helpers.readBody(req));
      sendJson(res, 200, await prepareOdooWorkorder({
        companyId, workorderId, userId: requestContext.actor.id, input,
      }));
      return true;
    }
    if (req.method === "GET" && action === "readiness") {
      sendJson(res, 200, await odooWorkorderReadiness({ companyId, workorderId }));
      return true;
    }
    if (req.method === "POST" && action === "draft") {
      const input = validated(createOdooDraftSchema, await helpers.readBody(req));
      sendJson(res, 201, await createOdooWorkorderDraft({
        companyId,
        workorderId,
        userId: requestContext.actor.id,
        requestId: req.requestId,
        input,
      }));
      return true;
    }
  }

  if (req.method === "GET" && url.pathname === "/api/integrations/clients") {
    const companyId = selectedCompanyId(url, requestContext);
    sendJson(res, 200, { clients: await companyIntegrationClients(companyId) });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/integrations/clients") {
    const companyId = selectedCompanyId(url, requestContext);
    const created = await createCompanyIntegrationClient(await helpers.readBody(req), {
      companyId,
      userId: requestContext.actor.id,
    });
    sendJson(res, 201, created);
    return true;
  }

  const revokeMatch = /^\/api\/integrations\/clients\/([^/]+)\/revoke$/.exec(url.pathname);
  if (req.method === "POST" && revokeMatch) {
    const companyId = selectedCompanyId(url, requestContext);
    const client = await revokeCompanyIntegrationClient({
      clientId: decodeURIComponent(revokeMatch[1]),
    }, {
      companyId,
      userId: requestContext.actor.id,
    });
    sendJson(res, 200, { client });
    return true;
  }

  return false;
}
