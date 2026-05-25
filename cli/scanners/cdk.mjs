/**
 * CDK Detector — Re-export shim.
 *
 * The CDK-specific detector has been generalized into a multi-tool IaC
 * detector at cli/scanners/iac.mjs covering CDK, Terraform, Pulumi, SAM,
 * and Serverless Framework. This module re-exports the CDK-only API for
 * backward compatibility. New code should import from iac.mjs directly.
 */

export { detectCDK, hasInfrastructureHeading } from './iac.mjs';
