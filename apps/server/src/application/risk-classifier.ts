import type { ActionRiskMetadata, ProposedAction, RegisteredActionType } from "../domain/action.js";

export interface RegisteredActionDefinition {
  type: RegisteredActionType;
  risk: ActionRiskMetadata;
}

/**
 * The only source of action risk information. Agent input may name an action,
 * target, payload, and rationale, but it cannot alter this registry.
 */
export const ACTION_REGISTRY: Readonly<Record<RegisteredActionType, RegisteredActionDefinition>> = {
  CREATE_INTERNAL_DRAFT: {
    type: "CREATE_INTERNAL_DRAFT",
    risk: {
      impact: "low",
      reversibility: "reversible",
      targetScope: "internal",
      requiredPermission: "internal_write",
      prohibited: false,
    },
  },
  SEND_EMAIL: {
    type: "SEND_EMAIL",
    risk: {
      impact: "low",
      reversibility: "reversible",
      targetScope: "external",
      requiredPermission: "external_write",
      prohibited: false,
    },
  },
  UPDATE_PRICING: {
    type: "UPDATE_PRICING",
    risk: {
      impact: "high",
      reversibility: "reversible",
      targetScope: "external",
      requiredPermission: "external_write",
      prohibited: false,
    },
  },
  DELETE_PROTECTED_DATA: {
    type: "DELETE_PROTECTED_DATA",
    risk: {
      impact: "critical",
      reversibility: "irreversible",
      targetScope: "protected",
      requiredPermission: "destructive",
      prohibited: true,
    },
  },
};

export interface RiskClassification {
  registered: boolean;
  actionType: string;
  risk?: ActionRiskMetadata;
}

export function classifyAction(action: Pick<ProposedAction, "type">): RiskClassification {
  const definition = ACTION_REGISTRY[action.type as RegisteredActionType];
  return definition === undefined
    ? { registered: false, actionType: action.type }
    : { registered: true, actionType: definition.type, risk: definition.risk };
}
