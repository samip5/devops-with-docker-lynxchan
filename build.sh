#!/bin/bash -ex

DOCKER_ARCH=${BUILD_ARCH:-amd64}
DOCKER_ORG=samip537
DOCKER_IMAGE=lynxchan:${DOCKER_ARCH}

docker build --build-arg ARCH=${DOCKER_ARCH} \
        -t $DOCKER_ORG/$DOCKER_IMAGE \
        -f Dockerfile .
