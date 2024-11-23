import * as cdk from "aws-cdk-lib";
import { AutoScalingGroup } from "aws-cdk-lib/aws-autoscaling";
import * as codebuild from "aws-cdk-lib/aws-codebuild";
import * as codedeploy from "aws-cdk-lib/aws-codedeploy";
import * as codepipeline from "aws-cdk-lib/aws-codepipeline";
import * as codepipelineActions from "aws-cdk-lib/aws-codepipeline-actions";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as iam from "aws-cdk-lib/aws-iam";
import * as s3 from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";

export class CICDStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const defaultVpc = ec2.Vpc.fromLookup(this, "vpc", {
      isDefault: true,
      region: this.region,
    });

    // S3 Bucket to store artifacts
    const artifactBucket = new s3.Bucket(this, "ArtifactBucket", {
      versioned: true,
    });

    // CodePipeline Artifacts
    const sourceOutput = new codepipeline.Artifact();
    const buildOutput = new codepipeline.Artifact();

    // Source Stage: GitHub Source Action
    const sourceAction = new codepipelineActions.GitHubSourceAction({
      actionName: "GitHub_Source",
      owner: "mohamed-abdelsamei", // Replace with your GitHub username
      repo: "aws-cicd-app", // Replace with your repository name
      branch: "main", // Branch to track
      oauthToken: cdk.SecretValue.secretsManager("github-token"), // Store token in Secrets Manager
      output: sourceOutput,
    });

    // Build Stage: CodeBuild Project
    const buildProject = new codebuild.PipelineProject(this, "BuildProject", {
      environment: {
        buildImage: codebuild.LinuxBuildImage.STANDARD_6_0,
      },
      buildSpec: codebuild.BuildSpec.fromSourceFilename("buildspec.yml"),
    });

    const buildAction = new codepipelineActions.CodeBuildAction({
      actionName: "Build",
      project: buildProject,
      input: sourceOutput,
      outputs: [buildOutput],
    });

    // Deploy Stage: CodeDeploy
    const application = new codedeploy.ServerApplication(this, "Application", {
      applicationName: "MyApplication",
    });
    const deploymentGroup = new codedeploy.ServerDeploymentGroup(
      this,
      "DeploymentGroup",
      {
        application,
        deploymentGroupName: "MyDeploymentGroup",
        installAgent: true,
        autoRollback: {
          failedDeployment: true,
        },
        deploymentConfig: codedeploy.ServerDeploymentConfig.ALL_AT_ONCE,
      }
    );

    const deployAction = new codepipelineActions.CodeDeployServerDeployAction({
      actionName: "Deploy",
      deploymentGroup,
      input: buildOutput,
    });

    // Define the Pipeline
    const pipeline = new codepipeline.Pipeline(this, "Pipeline", {
      pipelineName: "MyPipeline",
      artifactBucket,
    });

    pipeline.addStage({
      stageName: "Source",
      actions: [sourceAction],
    });
    pipeline.addStage({
      stageName: "Build",
      actions: [buildAction],
    });
    pipeline.addStage({
      stageName: "Deploy",
      actions: [deployAction],
    });

    // EC2 stack

    const securityGroup = new ec2.SecurityGroup(this, "securityGroup", {
      vpc: defaultVpc,
      allowAllOutbound: true,
    });
    securityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(22),
      "Allow SSH from anywhere"
    );
    securityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(3000),
      "Allow HTTP from anywhere"
    );
    securityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(80),
      "Allow HTTP from anywhere"
    );

    const userData = ec2.UserData.forLinux();
    userData.addCommands(
      "#!/bin/bash",
      // System updates and basic packages
      'echo "Updating system packages..."',
      "sudo yum update -y",
      "sudo yum install -y ruby wget",

      // NodeJS setup
      'echo "Setting up NodeJS Environment"',
      "if ! command -v node &> /dev/null; then",
      "    curl --silent --location https://rpm.nodesource.com/setup_20.x | sudo bash -",
      "    sudo yum install -y nodejs",
      "fi",

      // Development tools
      'echo "Installing development tools..."',
      'sudo yum group install -y "Development Tools"',
      "sudo yum install -y gcc-c++ make",

      // Yarn installation
      'echo "Installing Yarn..."',
      "if ! command -v yarn &> /dev/null; then",
      "    curl --silent --location https://dl.yarnpkg.com/rpm/yarn.repo | sudo tee /etc/yum.repos.d/yarn.repo",
      "    sudo yum install -y yarn",
      "fi",

      // PM2 setup
      'echo "Setting up PM2..."',
      "if ! command -v pm2 &> /dev/null; then",
      "    sudo npm install -g pm2@latest",
      "    sudo pm2 startup",
      "fi",

      // CodeDeploy agent setup
      'echo "Setting up CodeDeploy agent..."',
      "cd $HOME",
      "if [ ! -f ./install ]; then",
      "    wget https://XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX/latest/install",
      "    chmod +x ./install",
      "fi",
      "sudo ./install auto",

      // Ensure CodeDeploy agent is running
      "if ! systemctl is-active --quiet codedeploy-agent; then",
      "    sudo systemctl start codedeploy-agent",
      "fi",

      // Application directory setup
      'echo "Setting up application directory..."',
      "sudo mkdir -p $HOME/app",
      "sudo chown ec2-user:ec2-user $HOME/app",
      "sudo chmod 755 $HOME/app",

      // Verify installations
      'echo "Verifying installations..."',
      "node --version",
      "npm --version",
      "yarn --version",
      "pm2 --version",
      "sudo systemctl status codedeploy-agent",

      'echo "UserData script completed successfully"'
    );

    const instanceRole = new iam.Role(this, "InstanceRole", {
      assumedBy: new iam.ServicePrincipal("ec2.amazonaws.com"),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          "AmazonSSMManagedInstanceCore"
        ),
        iam.ManagedPolicy.fromAwsManagedPolicyName("AWSCodeDeployFullAccess"),
      ],
      description: "This is a role for my instance",
    });
    artifactBucket.grantRead(instanceRole);

    const launchTemplate = new ec2.LaunchTemplate(this, "LaunchTemplate", {
      instanceType: new ec2.InstanceType("t2.micro"),
      machineImage: new ec2.AmazonLinuxImage({
        generation: ec2.AmazonLinuxGeneration.AMAZON_LINUX_2023,
      }),
      userData: userData,
      role: instanceRole,
      securityGroup: securityGroup,
    });

    const autoScalingGroup = new AutoScalingGroup(this, "AutoScalingGroup", {
      vpc: defaultVpc,
      launchTemplate: launchTemplate,
      minCapacity: 1,
    });

    deploymentGroup.addAutoScalingGroup(autoScalingGroup);

    const elb = new elbv2.ApplicationLoadBalancer(this, "LoadBalancer", {
      vpc: defaultVpc,
      internetFacing: true,
    });
    const listener = elb.addListener("Listener", {
      port: 80,

      // 'open: true' is the default, you can leave it out if you want. Set it
      // to 'false' and use `listener.connections` if you want to be selective
      // about who can access the load balancer.
      open: true,
    });
    listener.addTargets("ApplicationFleet", {
      port: 3000,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targets: [autoScalingGroup],
    });
  }
}

// 1 create a project
// 2 enable aws connector in github
