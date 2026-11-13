pipeline {
    agent { label 'xingtu-build' }
    options {
        disableConcurrentBuilds()
        skipDefaultCheckout()
        buildDiscarder(logRotator(numToKeepStr: '20'))
        timeout(time: 25, unit: 'MINUTES')
    }
    triggers {
        pollSCM('H/5 * * * *')
    }
    stages {
        stage('Checkout') {
            steps {
                deleteDir()
                checkout scm
            }
        }
        stage('Build') {
            steps {
                sh '''
                    set -eu
                    npm ci --prefix legacy/immersive --ignore-scripts --no-audit --no-fund
                    npm ci --prefix deployment --ignore-scripts --no-audit --no-fund
                    python3 -m venv .venv
                    . .venv/bin/activate
                    python -m pip install --disable-pip-version-check -r deployment/requirements-contract.txt
                    node build.mjs
                '''
            }
        }
        stage('Verify') {
            steps {
                sh '''
                    set -eu
                    . .venv/bin/activate
                    export XT_CONTRACT_PYTHON="$PWD/.venv/bin/python"
                    python -m unittest discover -s test -p test_deployment_contract.py -v
                    node --test --test-timeout=90000 test/server.test.mjs test/launcher.test.mjs test/topology.test.mjs test/yaml-review.test.mjs test/host-check.test.mjs test/companion-flow.test.mjs test/deployment-assistant.test.mjs
                '''
            }
        }
        stage('Archive') {
            steps {
                sh '''
                    set -eu
                    git rev-parse HEAD > dist/commit.txt
                    (cd dist && sha256sum xingtu-server.jar > SHA256SUMS)
                '''
                archiveArtifacts artifacts: 'dist/xingtu-server.jar,dist/SHA256SUMS,dist/commit.txt,dist/Dockerfile,dist/deployment/*,dist/数栈7.0部署向导.html', fingerprint: true
            }
        }
    }
}
