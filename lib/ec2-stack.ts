import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as iam from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";
import { readFileSync } from "fs";

export class Ec2Stack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const defaultVpc = ec2.Vpc.fromLookup(this, "vpc", {
      isDefault: true,
      region: this.region,
    });

    const role = new iam.Role(this, "ec2-role", {
      assumedBy: new iam.ServicePrincipal("ec2.amazonaws.com"),
    });

    const sg = new ec2.SecurityGroup(this, "sg", {
      vpc: defaultVpc,
      allowAllOutbound: true,
    });
    sg.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(22),
      "Allow SSH from anywhere"
    );
    sg.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(80),
      "Allow HTTP from anywhere"
    );

    const ec2Instance = new ec2.Instance(this, "instance", {
      vpc: defaultVpc,
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.T2,
        ec2.InstanceSize.MICRO
      ),
      machineImage: new ec2.AmazonLinuxImage({
        generation: ec2.AmazonLinuxGeneration.AMAZON_LINUX_2,
      }),
      role: role,
      securityGroup: sg,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      userDataCausesReplacement: true,
    });

    const userDataScript = readFileSync("./lib/user-data.sh", "utf8");
    ec2Instance.addUserData(userDataScript);

    new cdk.CfnOutput(this, "instanceId", { value: ec2Instance.instanceId });
    new cdk.CfnOutput(this, "instancePublicIp", {
      value: ec2Instance.instancePublicIp,
    });
  }
}
